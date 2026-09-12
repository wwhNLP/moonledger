import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import chat_bridge as bridge


def fixture():
    return {'requestId': '00000000-0000-4000-8000-000000000001', 'messages': [{'role': 'user', 'content': '平均每天的伙食支出'}], 'ledger': {'book': 'demo', 'referenceMonth': '2026-09', 'today': '2026-09-13', 'scope': 'month', 'includeNotes': True, 'budgets': {'2026-09': 90000}, 'entries': [{'date': '2026-09-01', 'type': 'expense', 'category': '餐饮美食', 'amount': 13000, 'kind': 'normal', 'note': '合成聚餐'}]}}


class ChatTests(unittest.TestCase):
    def test_detail_sharing_and_opt_out_are_explicit(self):
        raw = fixture()
        self.assertEqual(bridge.clean_request(raw)['ledger']['entries'][0]['note'], '合成聚餐')
        raw['ledger']['includeNotes'] = False
        cleaned = bridge.clean_request(raw)
        self.assertEqual(cleaned['ledger']['entries'][0]['note'], '')
        self.assertEqual(raw['ledger']['entries'][0]['note'], '合成聚餐')

    def test_history_cannot_inject_system_roles_or_cli_options(self):
        raw = fixture(); raw['messages'][0]['role'] = 'system'
        with self.assertRaises(bridge.ChatError): bridge.clean_request(raw)
        raw = fixture(); raw['command'] = 'bash'
        with self.assertRaises(bridge.ChatError): bridge.clean_request(raw)
        raw = fixture(); raw['messages'][0]['content'] = '--tools bash @/private-file $(echo unsafe)'
        self.assertEqual(bridge.clean_request(raw)['messages'], raw['messages'])
        raw = fixture(); raw['ledger']['entries'][0]['amount'] = True
        with self.assertRaises(bridge.ChatError): bridge.clean_request(raw)

    def test_calendar_net_expense_and_transfers_match_local_accounting(self):
        raw = fixture()
        recovery = {**raw['ledger']['entries'][0], 'date': '2026-09-03', 'type': 'income', 'kind': 'refund', 'amount': 2600}
        transfer = {**recovery, 'kind': 'transfer', 'category': '其他收入', 'amount': 100000}
        future = {**raw['ledger']['entries'][0], 'date': '2026-09-20', 'amount': 9000}
        raw['ledger']['entries'] += [recovery, transfer, future]
        context = bridge.build_context(bridge.clean_request(raw)['ledger'])
        summary = context['monthlySummaries'][0]
        self.assertEqual(summary['netExpenseYuan'], 194)
        self.assertEqual(summary['dailyExpenseYuan'], 8)
        self.assertEqual(summary['incomeYuan'], 0)
        self.assertEqual(summary['dailyDays'], 13)
        self.assertEqual(context['entries'][0]['weekday'], '周二')
        self.assertEqual(summary['categories'][0]['dailyExpenseYuan'], 8)

    def test_month_scope_is_enforced_against_extra_records(self):
        raw = fixture()
        raw['ledger']['entries'].append({**raw['ledger']['entries'][0], 'date': '2026-08-01'})
        context = bridge.build_context(raw['ledger'])
        self.assertEqual(len(context['entries']), 1)
        raw['ledger']['scope'] = 'sixMonths'
        context = bridge.build_context(raw['ledger'])
        self.assertEqual(len(context['monthlySummaries']), 6)
        self.assertEqual(len(context['entries']), 2)
        raw['ledger']['scope'] = 'all'
        raw['ledger']['entries'][1]['date'] = '2026-06-01'
        context = bridge.build_context(raw['ledger'])
        self.assertEqual([s['month'] for s in context['monthlySummaries']], ['2026-06', '2026-07', '2026-08', '2026-09'])
        self.assertEqual(context['monthlySummaries'][1]['netExpenseYuan'], 0)

    def test_incomplete_model_reply_is_not_reported_as_done(self):
        with tempfile.TemporaryDirectory() as directory:
            executable, _ = self.executable(directory)
            executable.write_text(executable.read_text().replace('"stopReason":"stop"', '"stopReason":"length"'))
            with self.assertRaisesRegex(bridge.ChatError, '未完整结束'):
                list(bridge.stream_chat(fixture(), str(executable)))
            self.assertFalse(bridge.JOBS)

    def executable(self, directory, sleep=False):
        script = Path(directory) / 'fake-pi'
        capture = Path(directory) / 'captured.json'
        script.write_text('#!' + sys.executable + '\n' +
            'import json,sys,time\n' +
            f'open({str(capture)!r},"w").write(json.dumps({{"args":sys.argv[1:],"payload":json.loads(sys.stdin.read())}}))\n' +
            'print(json.dumps({"type":"session","cwd":"DO-NOT-FORWARD"}),flush=True)\n' +
            'print(json.dumps({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}),flush=True)\n' +
            ('time.sleep(60)\n' if sleep else '') +
            'print(json.dumps({"type":"message_end","message":{"role":"assistant","stopReason":"stop","model":"test-model","provider":"test","content":[{"type":"text","text":"complete answer"}]}}),flush=True)\n')
        script.chmod(0o700)
        return script, capture

    def test_pi_uses_stdin_fixed_flags_and_streams_only_assistant_text(self):
        with tempfile.TemporaryDirectory() as directory:
            executable, capture = self.executable(directory)
            raw = fixture()
            raw['messages'] += [{'role': 'assistant', 'content': '日均10元。'}, {'role': 'user', 'content': '再扣掉聚餐呢？'}]
            events = list(bridge.stream_chat(bridge.clean_request(raw), str(executable)))
            captured = json.loads(capture.read_text())
            for flag in ['--no-tools', '--no-extensions', '--no-session', '--no-context-files', '--no-skills', '--no-prompt-templates']:
                self.assertIn(flag, captured['args'])
            self.assertNotIn('再扣掉聚餐呢？', captured['args'])
            self.assertEqual(captured['payload']['conversation'], raw['messages'])
            self.assertEqual(events[-1]['text'], 'complete answer')
            self.assertNotIn('DO-NOT-FORWARD', json.dumps(events))
            self.assertFalse(bridge.JOBS)

    def test_cancel_timeout_and_disconnect_reap_the_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            executable, _ = self.executable(directory, sleep=True)
            for action in ['cancel', 'close', 'timeout']:
                processes = []
                original = subprocess.Popen
                def spawn(*args, **kwargs):
                    process = original(*args, **kwargs); processes.append(process); return process
                with patch.object(bridge.subprocess, 'Popen', side_effect=spawn):
                    events = bridge.stream_chat(fixture(), str(executable), timeout=.1 if action == 'timeout' else 10)
                    self.assertEqual(next(events)['type'], 'start')
                    if action == 'cancel':
                        self.assertTrue(bridge.cancel(fixture()['requestId']))
                        self.assertEqual(list(events)[-1]['type'], 'cancelled')
                    elif action == 'close':
                        events.close()
                    else:
                        with self.assertRaises(bridge.ChatError): list(events)
                self.assertTrue(all(p.poll() is not None for p in processes))
                self.assertFalse(bridge.JOBS)
                self.assertFalse(bridge.PROCESSES)


if __name__ == '__main__':
    unittest.main()
