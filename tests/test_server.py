import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from email.message import Message
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('moon_server', Path(__file__).parents[1] / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def fixture():
    return {'task': 'review', 'data': {'focus': 'review', 'measure': 'all', 'category': 'all', 'excludeRent': False, 'periods': [{'id': 'P0', 'income': 10000, 'expense': 3800, 'balance': 6200, 'budget': 8000, 'count': 2, 'categories': [{'category': '餐饮美食', 'amount': 3800, 'count': 1}, {'category': '工资薪酬', 'amount': 10000, 'count': 1}]}], 'facts': [{'id': 'F0', 'metric': 'expense', 'value': 3800, 'unit': 'cents', 'periodId': 'P0', 'category': 'all'}]}}


class PrivacyTests(unittest.TestCase):
    def handler(self, body=None):
        handler = object.__new__(server.Handler)
        handler.server = SimpleNamespace(server_address=('127.0.0.1', 4173))
        handler.headers = Message()
        handler.headers['Host'] = '127.0.0.1:4173'
        handler.headers['Origin'] = 'http://127.0.0.1:4173'
        handler.headers['X-Moonledger-Token'] = server.CSRF_TOKEN
        handler.headers['Content-Type'] = 'application/json'
        encoded = json.dumps(body or fixture()).encode()
        handler.headers['Content-Length'] = str(len(encoded))
        handler.rfile = io.BytesIO(encoded)
        handler.connection = SimpleNamespace(settimeout=lambda timeout: None)
        handler.path = '/api/ai'
        handler.reply = lambda payload, status=200: (payload, status)
        return handler

    def test_origin_host_and_token_block_requests_before_upstream(self):
        for header, value in [('Host', 'attacker.example:4173'), ('Origin', 'https://attacker.example'), ('X-Moonledger-Token', 'invalid')]:
            handler = self.handler()
            handler.headers.replace_header(header, value)
            replies = []
            handler.reply = lambda payload, status=200: replies.append((payload, status))
            with patch.object(server, 'call_deepseek') as upstream:
                handler.do_POST()
            self.assertEqual(replies[0][1], 403)
            upstream.assert_not_called()

    def test_status_never_returns_key(self):
        handler = self.handler(); handler.path = '/api/status'
        with patch.object(server, 'read_config', return_value=('sk-fake-secret-not-real', 'deepseek-flash', 'local')):
            payload, status = handler.do_GET()
        self.assertEqual(status, 200)
        self.assertTrue(payload['configured'])
        self.assertNotIn('sk-fake', json.dumps(payload))
        self.assertEqual(set(payload), {'configured', 'model', 'source', 'csrfToken'})

    def test_private_config_is_not_a_static_asset(self):
        handler = self.handler(); handler.path = '/.local/deepseek.json'
        self.assertEqual(handler.do_GET()[1], 404)

    def test_invalid_config_can_be_replaced(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'CONFIG', Path(directory) / 'deepseek.json'), patch.dict(os.environ, {}, clear=True):
            server.CONFIG.write_text('[]')
            with self.assertRaises(server.UserError): server.read_config()
            server.save_config({'apiKey': 'sk-fake-not-real', 'model': 'deepseek-flash'})
            self.assertEqual(server.read_config()[2], 'local')

    def test_extra_fields_never_forwarded(self):
        for level, key in [('root', 'prompt'), ('data', 'rawQuestion'), ('period', 'note'), ('category', 'merchant')]:
            data = fixture()
            target = data if level == 'root' else data['data'] if level == 'data' else data['data']['periods'][0] if level == 'period' else data['data']['periods'][0]['categories'][0]
            target[key] = '张三 private@example.com'
            with self.assertRaises(server.UserError):
                server.clean_request(data)

    def test_aggregate_and_category_integrity(self):
        self.assertEqual(server.clean_request(fixture()), fixture())
        data = fixture(); data['data']['periods'][0]['balance'] = 2
        with self.assertRaises(server.UserError): server.clean_request(data)

    def test_signed_expense_recoveries_are_allowed_but_income_cannot_be_negative(self):
        data = fixture()
        period = data['data']['periods'][0]
        period.update(income=0, expense=-3000, balance=3000, count=1,
                      categories=[{'category': '餐饮美食', 'amount': -3000, 'count': 1}])
        data['data']['facts'][0]['value'] = -3000
        self.assertEqual(server.clean_request(data), data)
        period['categories'][0]['category'] = '工资薪酬'
        with self.assertRaises(server.UserError): server.clean_request(data)
        data = fixture(); data['data']['periods'][0]['categories'][0]['category'] = '张三'
        with self.assertRaises(server.UserError): server.clean_request(data)

    def test_classification_contains_only_fixed_hints(self):
        payload = {'task': 'categorize', 'data': {'candidates': [{'id': 'T0', 'hints': ['餐饮'], 'typeHint': 'expense'}]}}
        self.assertEqual(server.clean_request(payload), payload)
        payload['data']['candidates'][0]['hints'] = ['张三午饭38元']
        with self.assertRaises(server.UserError): server.clean_request(payload)

    def test_model_output_cannot_invent_facts_or_amounts(self):
        response = {'summary': '餐饮值得留意', 'insights': [{'factId': 'F0', 'explanation': '可核对日常消费。'}], 'suggestions': ['定期检查支出分类。']}
        self.assertEqual(server.validate_result(response, fixture()), response)
        for invalid in [{'summary': '你花了99999元', 'insights': [], 'suggestions': []}, {'summary': '餐饮值得留意', 'insights': [{'factId': 'F99', 'explanation': '检查。'}], 'suggestions': []}]:
            with self.assertRaises(server.UserError): server.validate_result(invalid, fixture())

    def test_key_stored_with_restrictive_permissions(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'CONFIG', Path(directory) / 'secret' / 'deepseek.json'), patch.dict(os.environ, {}, clear=True):
            server.save_config({'apiKey': 'sk-test-only-not-real', 'model': 'deepseek-flash'})
            self.assertEqual(server.CONFIG.stat().st_mode & 0o777, 0o600)
            self.assertEqual(server.CONFIG.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(server.read_config(), ('sk-test-only-not-real', 'deepseek-flash', 'local'))

    def test_mocked_deepseek_round_trip(self):
        result = {'summary': '餐饮支出可以重点核对', 'insights': [{'factId': 'F0', 'explanation': '先确认是否有一次性消费。'}], 'suggestions': ['按自己的生活节奏安排预算。']}
        response = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(result)}}], 'usage': {'total_tokens': 80}}
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return Reply(json.dumps(response).encode())
        opener = Opener()
        with patch.object(server, 'read_config', return_value=('sk-fake-not-real', 'deepseek-flash', 'local')), patch.object(server.urllib.request, 'build_opener', return_value=opener):
            actual = server.call_deepseek(server.clean_request(fixture()))
        sent = json.loads(opener.request.data)
        self.assertEqual(actual['result'], result)
        self.assertEqual(opener.request.full_url, 'https://api.deepseek.com/chat/completions')
        self.assertNotIn('sk-fake', json.dumps(sent))
        self.assertEqual(json.loads(sent['messages'][1]['content']), fixture()['data'])

    def test_unconfigured_key_fails_before_network(self):
        with patch.object(server, 'read_config', return_value=('', 'deepseek-flash', 'none')), patch.object(server.urllib.request, 'build_opener') as network:
            with self.assertRaises(server.UserError) as raised: server.call_deepseek(fixture())
            self.assertEqual(raised.exception.status, 428)
            network.assert_not_called()


if __name__ == '__main__': unittest.main()
