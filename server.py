#!/usr/bin/env python3
"""Loopback-only Moonledger server. Ledger records never live on this server."""
import argparse
import base64
import collections
import functools
import http.server
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.request
from import_xlsx import read_xlsx

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / '.local' / 'deepseek.json'
API_URL = 'https://api.deepseek.com/chat/completions'
DEFAULT_MODEL = 'deepseek-flash'
CATEGORIES = ['餐饮美食', '居家生活', '购物消费', '交通出行', '休闲娱乐', '医疗健康', '学习成长', '其他支出', '工资薪酬', '兼职收入', '投资收益', '其他收入']
HINTS = ['餐饮', '咖啡', '居家', '房租', '购物', '交通', '娱乐', '健康', '学习', '工资', '兼职', '投资', '收入', '支出', '待确认']
METRICS = ['income', 'expense', 'balance', 'budget', 'count', 'days', 'average', 'perEntryAverage', 'difference', 'category', 'remaining']
FOCUS = ['review', 'total', 'compare', 'average', 'ranking', 'budget']
MAX_CENTS = 9_000_000_000_000_000
CSRF_TOKEN = secrets.token_urlsafe(32)
CALL_TIMES = collections.deque()
CALL_LOCK = threading.Lock()
CONFIG_LOCK = threading.Lock()
CALL_SLOTS = threading.BoundedSemaphore(2)


class UserError(Exception):
    def __init__(self, message, status=400, code='INVALID_REQUEST'):
        self.message, self.status, self.code = message, status, code
        super().__init__(message)


def exact_keys(value, required, optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise UserError('数据包含未允许的字段，已阻止发送。')


def number(value, minimum=0, maximum=MAX_CENTS):
    if type(value) is not int or not minimum <= value <= maximum:
        raise UserError('汇总数字无效，已阻止发送。')
    return value


def choice(value, allowed):
    if not isinstance(value, str) or value not in allowed:
        raise UserError('数据类型不在脱敏白名单内。')
    return value


def clean_request(raw):
    """Reject extras; never forward arbitrary prompts or user-authored strings."""
    exact_keys(raw, ['task', 'data'])
    task = choice(raw['task'], ['review', 'question', 'categorize'])
    data = raw['data']
    if task == 'categorize':
        exact_keys(data, ['candidates'])
        if not isinstance(data['candidates'], list) or not 1 <= len(data['candidates']) <= 20:
            raise UserError('每次可整理 1—20 笔账单。')
        candidates = []
        for i, row in enumerate(data['candidates']):
            exact_keys(row, ['id', 'hints', 'typeHint'])
            if row['id'] != f'T{i}' or not isinstance(row['hints'], list) or not 1 <= len(row['hints']) <= 8:
                raise UserError('匿名账单编号或分类提示无效。')
            candidates.append({'id': row['id'], 'hints': [choice(x, HINTS) for x in row['hints']], 'typeHint': choice(row['typeHint'], ['income', 'expense', 'unknown'])})
        return {'task': task, 'data': {'candidates': candidates}}

    exact_keys(data, ['focus', 'periods', 'facts', 'category', 'excludeRent', 'measure'], ['averageUnit', 'filtered'])
    context = {}
    if 'averageUnit' in data:
        context['averageUnit'] = choice(data['averageUnit'], ['day', 'month', 'entry'])
    if 'filtered' in data:
        if type(data['filtered']) is not bool:
            raise UserError('筛选状态无效。')
        context['filtered'] = data['filtered']
    measure = choice(data['measure'], ['income', 'expense', 'balance', 'all'])
    focus = choice(data['focus'], FOCUS)
    category = choice(data['category'], ['all'] + CATEGORIES)
    if type(data['excludeRent']) is not bool:
        raise UserError('筛选条件无效。')
    if not isinstance(data['periods'], list) or not 1 <= len(data['periods']) <= 24:
        raise UserError('分析范围须为 1—24 个月。')
    periods = []
    for i, period in enumerate(data['periods']):
        exact_keys(period, ['id', 'income', 'expense', 'balance', 'budget', 'count', 'categories'], ['days'])
        calendar = {'days': number(period['days'], minimum=1, maximum=31)} if 'days' in period else {}
        if period['id'] != f'P{i}':
            raise UserError('匿名月份编号无效。')
        income, expense = number(period['income']), number(period['expense'], -MAX_CENTS)
        balance = number(period['balance'], -MAX_CENTS)
        if balance != income - expense:
            raise UserError('收支汇总不一致。')
        categories = period['categories']
        if not isinstance(categories, list) or len(categories) > len(CATEGORIES):
            raise UserError('分类汇总无效。')
        cleaned_categories, seen = [], set()
        for row in categories:
            exact_keys(row, ['category', 'amount', 'count'])
            cat = choice(row['category'], CATEGORIES)
            if cat in seen:
                raise UserError('汇总中存在重复分类。')
            seen.add(cat)
            cleaned_categories.append({'category': cat, 'amount': number(row['amount'], -MAX_CENTS if cat in CATEGORIES[:8] else 0), 'count': number(row['count'], maximum=50000)})
        if sum(row['amount'] for row in cleaned_categories if row['category'] in CATEGORIES[:8]) != expense:
            raise UserError('支出与分类汇总不一致。')
        if sum(row['amount'] for row in cleaned_categories if row['category'] in CATEGORIES[8:]) != income:
            raise UserError('收入与分类汇总不一致。')
        count = number(period['count'], maximum=50000)
        if sum(row['count'] for row in cleaned_categories) != count:
            raise UserError('账单笔数不一致。')
        periods.append({'id': period['id'], 'income': income, 'expense': expense, 'balance': balance, 'budget': None if period['budget'] is None else number(period['budget']), 'count': count, 'categories': cleaned_categories, **calendar})
    if focus == 'average' and context.get('averageUnit') == 'day' and any('days' not in p for p in periods):
        raise UserError('日均分析缺少计算天数。')
    if not isinstance(data['facts'], list) or not 1 <= len(data['facts']) <= 16:
        raise UserError('分析依据无效。')
    facts = []
    for i, row in enumerate(data['facts']):
        exact_keys(row, ['id', 'metric', 'value', 'unit', 'periodId', 'category'])
        if row['id'] != f'F{i}' or row['periodId'] not in [p['id'] for p in periods] + ['all']:
            raise UserError('分析依据编号无效。')
        facts.append({'id': row['id'], 'metric': choice(row['metric'], METRICS), 'value': number(row['value'], -MAX_CENTS), 'unit': choice(row['unit'], ['cents', 'count', 'days']), 'periodId': row['periodId'], 'category': choice(row['category'], ['all'] + CATEGORIES)})
    return {'task': task, 'data': {'focus': focus, 'periods': periods, 'facts': facts, 'category': category, 'excludeRent': data['excludeRent'], 'measure': measure, **context}}


def read_config():
    local = {}
    try:
        if CONFIG.exists():
            local = json.loads(CONFIG.read_text())
            if not isinstance(local, dict):
                raise ValueError('Configuration must be an object')
    except (ValueError, OSError):
        raise UserError('本地 AI 配置无法读取，请重新保存设置。', 503, 'CONFIG_ERROR')
    key = local.get('apiKey') or os.environ.get('DEEPSEEK_API_KEY', '')
    model = local.get('model') or os.environ.get('DEEPSEEK_MODEL', DEFAULT_MODEL)
    return key, model, ('local' if local.get('apiKey') else 'environment' if key else 'none')


def save_config(raw):
    exact_keys(raw, ['model'], ['apiKey', 'clearKey'])
    model = raw['model']
    if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{1,79}', model):
        raise UserError('模型名称格式不正确。')
    with CONFIG_LOCK:
        local = {}
        try:
            if CONFIG.exists():
                local = json.loads(CONFIG.read_text())
                if not isinstance(local, dict):
                    local = {}
        except (OSError, ValueError):
            pass
        key = raw.get('apiKey', '')
        if not isinstance(key, str) or len(key) > 256 or (key and not re.fullmatch(r'[A-Za-z0-9_-]{10,256}', key)):
            raise UserError('API Key 格式不正确，请检查是否完整。')
        if raw.get('clearKey') is True:
            local.pop('apiKey', None)
        elif key:
            local['apiKey'] = key
        local['model'] = model
        CONFIG.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(CONFIG.parent, 0o700)
        temporary = CONFIG.with_suffix('.tmp')
        fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, 'w') as handle:
                json.dump(local, handle)
            os.chmod(temporary, 0o600)
            os.replace(temporary, CONFIG)
        finally:
            if temporary.exists():
                temporary.unlink()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def prompt_for(payload):
    if payload['task'] == 'categorize':
        return ('你是中文个人记账分类助手。只根据匿名消费提示分类，不推测姓名、商户、金额和日期。'
                '必须输出 JSON，格式 {"items":[{"id":"T0","type":"expense","category":"餐饮美食"}]}。'
                '每个输入ID恰好输出一次；type只能income/expense。已明确的typeHint必须保留；unknown需保守选择。'
                '收入分类只能' + '、'.join(CATEGORIES[8:]) + '；支出分类只能' + '、'.join(CATEGORIES[:8]) + '。')
    return ('你是谨慎的个人收支复盘助手。输入仅为脱敏汇总，金额单位分，P0是所选参考月，之后是更早月份。'
            'focus为用户在本地确认后的问题类型：total合计、compare比较、average平均、ranking消费排行、budget预算、review复盘。averageUnit表示平均口径：day日均、month月均、entry笔均，缺省为月均。日均用periods.days中的日历天数，包含零消费日；当月截至今天，其他月份按整月。笔均按筛选记录数，包含回款记录。平均值和总额均以facts为准，不把日均说成月均。'
            'filtered为true时已在本机按分类、收支类型、备注或单笔金额等条件筛选，只代表匹配记录，不代表完整账本，不推测被隐藏的筛选原文。不能因为只看到餐饮就称餐饮是全账本唯一消费；不能根据净支出推断没有退款。perEntryAverage是本地计算的笔均，可与日均区分说明。measure表示关注收入、支出、结余还是全部。只解读相关指标；若只查询支出，income为零不代表没有收入。'
            'expense及支出分类均为到账月净支出：退款和报销冲减支出，负数表示收回金额超过当月消费；内部转账不计收支。没有原始账单，不得假定交易内容、商户、姓名、职业或具体生活事件。相邻月份可能一个尚未结束，不能简单认定消费习惯改善。'
            '数字与金额已由应用计算。可以引用facts中已有的平均值、总额、天数或笔数；金额单位分，显示时换算成元，使用阿拉伯数字。除单位换算外不要自行计算，不编造节省金额、频次、占比或百分数。匿名编号用来定位依据，优先在insights.factId中引用。'
            '仅解释已给事实，原因只能写成可核对的可能性，不下定论，不提供投资买卖建议。无记录不代表没有真实收支。'
            '必须输出 JSON：{"summary":"简短解读","insights":[{"factId":"F0","explanation":"依据说明"}],"suggestions":["可操作的核对建议"]}。'
            'summary最多180字，insights最多4项且factId必须来自输入facts，suggestions最多3项，每项最多100字。')


def validate_result(result, payload):
    if payload['task'] == 'categorize':
        exact_keys(result, ['items'])
        if not isinstance(result['items'], list) or len(result['items']) != len(payload['data']['candidates']):
            raise UserError('AI 返回的账单数量不一致，请使用本地预览核对。', 502, 'AI_RESPONSE')
        expected = {r['id']: r for r in payload['data']['candidates']}
        seen = set()
        for row in result['items']:
            exact_keys(row, ['id', 'type', 'category'])
            if row['id'] not in expected or row['id'] in seen:
                raise UserError('AI 返回的匿名编号不一致。', 502, 'AI_RESPONSE')
            seen.add(row['id'])
            kind = choice(row['type'], ['income', 'expense'])
            if expected[row['id']]['typeHint'] not in ['unknown', kind]:
                raise UserError('AI 改变了已确认的收支类型，请手动核对。', 502, 'AI_RESPONSE')
            choice(row['category'], CATEGORIES[:8] if kind == 'expense' else CATEGORIES[8:])
        return result

    exact_keys(result, ['summary', 'insights', 'suggestions'])
    # Permit grounded numbers, instead of rejecting an otherwise valid answer
    # simply because it repeats the locally computed daily average.
    money_numbers = {abs(row['value'] / 100) for row in payload['data']['facts'] if row['unit'] == 'cents'}
    count_numbers = {abs(row['value']) for row in payload['data']['facts'] if row['unit'] != 'cents'}
    for period in payload['data']['periods']:
        money_numbers.update(abs(period[key] / 100) for key in ['income', 'expense', 'balance', 'budget'] if period[key] is not None)
        count_numbers.add(period['count'])
        if 'days' in period:
            count_numbers.add(period['days'])
        money_numbers.update(abs(row['amount'] / 100) for row in period['categories'])
    allowed_numbers = money_numbers | count_numbers
    known_ids = {row['id'] for row in payload['data']['facts']} | {row['id'] for row in payload['data']['periods']}
    def text(value, limit):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise UserError('AI 返回内容不完整，请重试。', 502, 'AI_RESPONSE')
        checked = re.sub(r'(?<![A-Za-z0-9])[FP]\d+(?!\d)', lambda match: '' if match.group() in known_ids else match.group(), value)
        invalid = False
        for match in re.finditer(r'[¥￥]?\s*\d+(?:,\d{3})*(?:\.\d+)?', checked):
            token = match.group().strip()
            monetary = token.startswith(('¥', '￥')) or re.match(r'\s*(?:元|块|人民币)', checked[match.end():])
            number_value = float(token.lstrip('¥￥').strip().replace(',', ''))
            invalid |= number_value not in (money_numbers if monetary else allowed_numbers)
        if invalid or re.search(r'\d\s*[％%]|[零一二三四五六七八九十百千万亿]+\s*(?:元|％|%)', checked):
            raise UserError('AI 文本含有无法核对的推算。', 502, 'AI_UNGROUNDED')
        return value.strip()
    omitted = False
    def grounded(value, limit):
        nonlocal omitted
        try:
            return text(value, limit)
        except UserError as error:
            if error.code != 'AI_UNGROUNDED':
                raise
            omitted = True
            return None
    summary = grounded(result['summary'], 500) or '统计结果已在本地核对，可查看下方金额与计算口径。'
    if not isinstance(result['insights'], list) or len(result['insights']) > 4 or not isinstance(result['suggestions'], list) or len(result['suggestions']) > 3:
        raise UserError('AI 响应结构不正确。', 502, 'AI_RESPONSE')
    facts = {row['id'] for row in payload['data']['facts']}
    insights = []
    for row in result['insights']:
        exact_keys(row, ['factId', 'explanation'])
        if row['factId'] not in facts:
            raise UserError('AI 引用了不存在的依据。', 502, 'AI_RESPONSE')
        explanation = grounded(row['explanation'], 350)
        if explanation:
            insights.append({'factId': row['factId'], 'explanation': explanation})
    suggestions = [value for s in result['suggestions'] if (value := grounded(s, 200))]
    return {'summary': summary, 'insights': insights, 'suggestions': suggestions, **({'omittedNumericText': True} if omitted else {})}


def call_deepseek(payload):
    key, model, _ = read_config()
    if not key:
        raise UserError('请先在 AI 设置中填写 DeepSeek API Key。', 428, 'KEY_REQUIRED')
    with CALL_LOCK:
        now = time.monotonic()
        while CALL_TIMES and CALL_TIMES[0] < now - 60:
            CALL_TIMES.popleft()
        if len(CALL_TIMES) >= 12:
            raise UserError('调用较频繁，请稍后再试。', 429, 'RATE_LIMIT')
        CALL_TIMES.append(now)
    if not CALL_SLOTS.acquire(blocking=False):
        raise UserError('已有分析正在进行，请稍候。', 429, 'BUSY')
    try:
        request_body = {'model': model, 'messages': [{'role': 'system', 'content': prompt_for(payload)}, {'role': 'user', 'content': json.dumps(payload['data'], ensure_ascii=False)}], 'response_format': {'type': 'json_object'}, 'stream': False, 'thinking': {'type': 'disabled'}, 'max_tokens': 2000 if payload['task'] != 'categorize' else 1000}
        request = urllib.request.Request(API_URL, data=json.dumps(request_body).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept': 'application/json'}, method='POST')
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=50) as response:
                raw = response.read(1_048_577)
                if len(raw) > 1_048_576:
                    raise UserError('AI 响应过大，请缩小分析范围。', 502, 'AI_RESPONSE')
            envelope = json.loads(raw)
            answer = envelope['choices'][0]
            if answer.get('finish_reason') != 'stop':
                raise UserError('AI 响应未完成，请重试。', 502, 'AI_RESPONSE')
            result = validate_result(json.loads(answer['message']['content']), payload)
            usage = envelope.get('usage', {})
            return {'result': result, 'model': model, 'usage': {'total_tokens': usage.get('total_tokens', 0)}}
        except urllib.error.HTTPError as error:
            messages = {401: 'API Key 无效，请检查 AI 设置。', 402: 'DeepSeek 账户余额不足，请在官方平台检查。', 429: 'DeepSeek 暂时限流，请稍后重试。', 400: '模型或请求配置不被支持，请核对模型名称。', 404: '模型或接口不存在，请核对模型名称。'}
            raise UserError(messages.get(error.code, 'DeepSeek 服务暂时不可用，请稍后重试。'), 502, 'UPSTREAM_ERROR') from None
        except (socket.timeout, TimeoutError):
            raise UserError('分析超时。账本和输入仍在本地，可稍后重试。', 504, 'TIMEOUT') from None
        except urllib.error.URLError:
            raise UserError('无法连接 DeepSeek，请检查网络后重试。', 502, 'NETWORK_ERROR') from None
        except (KeyError, IndexError, ValueError, TypeError):
            raise UserError('AI 返回格式不正确，未修改任何账单。请重试。', 502, 'AI_RESPONSE') from None
    finally:
        CALL_SLOTS.release()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Never log URLs, request bodies, upstream responses or credentials.
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        super().end_headers()

    def allowed_host(self):
        port = self.server.server_address[1]
        return self.headers.get('Host') in [f'127.0.0.1:{port}', f'localhost:{port}']

    def reply(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.allowed_host():
            return self.reply({'error': '仅允许本机访问。'}, 403)
        if self.path == '/api/status':
            try:
                key, model, source = read_config()
                return self.reply({'configured': bool(key), 'model': model, 'source': source, 'csrfToken': CSRF_TOKEN})
            except UserError as error:
                return self.reply({'error': error.message, 'code': error.code, 'csrfToken': CSRF_TOKEN}, error.status)
        if self.path.startswith('/api/'):
            return self.reply({'error': '接口不存在。'}, 404)
        if self.path.split('?')[0] not in ['/', '/index.html', '/styles.css', '/ledger.js', '/app.js', '/privacy.js', '/ai.js', '/ai.css', '/features-core.js', '/features-ui.js', '/features.css']:
            return self.reply({'error': '文件不存在。'}, 404)
        super().do_GET()

    def do_HEAD(self):
        if not self.allowed_host():
            self.send_error(403)
            return
        super().do_HEAD()

    def do_POST(self):
        try:
            expected_origin = 'http://' + self.headers.get('Host', '')
            if not self.allowed_host() or self.headers.get('Origin') != expected_origin or not secrets.compare_digest(self.headers.get('X-Moonledger-Token', ''), CSRF_TOKEN):
                raise UserError('请求来源无效，请刷新本地网站后重试。', 403, 'ORIGIN_ERROR')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise UserError('只接受 JSON 请求。', 415)
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise UserError('请求大小无效。')
            if length <= 0 or length > (14_500_000 if self.path == '/api/import-xlsx' else 100_000):
                raise UserError('请求过大或为空。', 413)
            self.connection.settimeout(10)
            try:
                raw = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                raise UserError('请求格式不正确。')
            if self.path == '/api/settings':
                save_config(raw)
                key, model, source = read_config()
                return self.reply({'configured': bool(key), 'model': model, 'source': source})
            if self.path == '/api/import-xlsx':
                exact_keys(raw, ['file'])
                if not isinstance(raw['file'], str):
                    raise UserError('文件格式无效。')
                try:
                    data = base64.b64decode(raw['file'], validate=True)
                    return self.reply({'sheets': read_xlsx(data)})
                except (ValueError, OSError, KeyError, OverflowError):
                    raise UserError('无法解析表格，请选择已解锁、未损坏且小于 10 MB 的 XLSX；也可使用 CSV。') from None
            if self.path == '/api/ai':
                return self.reply(call_deepseek(clean_request(raw)))
            raise UserError('接口不存在。', 404)
        except UserError as error:
            self.reply({'error': error.message, 'code': error.code}, error.status)
        except Exception:
            self.reply({'error': '本地服务处理失败。未修改账本，请重试。', 'code': 'LOCAL_ERROR'}, 500)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT / 'dist')))
    server.daemon_threads = True
    print(f'月见已启动：http://127.0.0.1:{args.port}', flush=True)
    print('账本保存在浏览器；AI 仅在点击发送时调用。按 Control+C 停止。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
