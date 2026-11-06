# shad_export_api.py
# Fallback exporter using the SHAD HTTP API (requires auth token).
# Use this only if the DOM-based shad_export.js returns 0 messages.
#
# How to get AUTH:
#   1) Open web.shad.ir, log in, open DevTools (F12) -> Network tab.
#   2) Open a chat / send a message so a request appears whose domain starts with 'shadmessenger'.
#   3) Click that request -> Request tab -> find 'auth' field (a string). Copy it.
#
# Run:  python shad_export_api.py
import base64, json, random, time, sys
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
import requests


class Crypto:
    def __init__(self, key):
        if len(key) != 32 and not key.isalpha():
            raise ValueError('AUTH looks invalid (must be 32 chars)')
        secret = ''.join(chr(((ord(c) - 97 + 9) % 26) + 97) for c in (key[16:24] + key[0:8] + key[24:32] + key[8:16]))
        self.key = secret.encode('utf-8')
        self.iv = b'\x00' * 16

    def encrypt(self, text):
        c = AES.new(self.key, AES.MODE_CBC, self.iv)
        return base64.b64encode(c.encrypt(pad(text.encode('utf-8'), 16))).decode('utf-8')

    def decrypt(self, text):
        c = AES.new(self.key, AES.MODE_CBC, self.iv)
        return unpad(c.decrypt(base64.b64decode(text.encode('utf-8'))), 16).decode('utf-8')


def make_request(auth, method, data):
    crypto = Crypto(auth)
    payload = {
        'method': method,
        'input': data,
        'client': {
            'app_name': 'Main',
            'app_version': '4.1.12',
            'platform': 'Web',
            'package': 'web.shad.ir',
            'lang_code': 'fa',
        },
    }
    body = {
        'api_version': '5',
        'auth': auth,
        'data_enc': crypto.encrypt(json.dumps(payload)),
    }
    url = 'https://shadmessenger%d.iranlms.ir/' % random.randint(1, 90)
    r = requests.post(url, json=body, timeout=30)
    r.raise_for_status()
    resp = r.json()
    dec = crypto.decrypt(resp.get('data_enc'))
    obj = json.loads(dec)
    if obj.get('status') != 'OK':
        raise RuntimeError('API status: %s / %s' % (obj.get('status'), obj.get('status_det')))
    return obj


def get_chats(auth):
    obj = make_request(auth, 'getChats', {'start_id': None})
    return obj.get('data', {}).get('chats', [])


def get_messages(auth, object_guid, sort, cursor):
    data = {'object_guid': object_guid, 'sort': sort}
    if sort == 'FromMax':
        data['max_id'] = int(cursor)
    elif sort == 'FromMin':
        data['min_id'] = int(cursor)
    obj = make_request(auth, 'getMessages', data)
    return obj.get('data', {}).get('messages', [])


def msg_id(m):
    for k in ('message_id', 'id', 'msg_id', 'messageId'):
        if k in m and m[k] is not None:
            return m[k]
    return None


def msg_text(m):
    for k in ('text', 'message', 'caption', 'body'):
        if k in m and m[k] is not None:
            return m[k]
    return ''


def msg_time(m):
    for k in ('time', 'date', 'date_time', 'datetime', 'timestamp'):
        if k in m and m[k] is not None:
            return m[k]
    return ''


def msg_from(m):
    for k in ('from', 'sender', 'author', 'from_name', 'sender_name'):
        if k in m and m[k] is not None:
            return m[k]
    # nested
    for k in ('sender', 'from_user', 'author'):
        v = m.get(k)
        if isinstance(v, dict):
            for kk in ('name', 'username', 'title'):
                if kk in v:
                    return v[kk]
    return ''


def msg_reply(m):
    for k in ('reply_to_message_id', 'reply_message_id', 'reply_to', 'replied_message_id'):
        if k in m and m[k] is not None:
            return m[k]
    return None


def main():
    print('SHAD API exporter')
    auth = input('Paste AUTH token: ').strip()
    if not auth:
        print('AUTH required'); sys.exit(1)

    print('Fetching chat list...')
    try:
        chats = get_chats(auth)
    except Exception as e:
        print('Failed to fetch chats:', e)
        sys.exit(1)

    if not chats:
        print('No chats returned.'); sys.exit(1)

    print('\nChats:')
    for i, c in enumerate(chats):
        title = c.get('title') or c.get('name') or c.get('object_guid') or c
        print('  %d) %s   (guid=%s)' % (i, title, c.get('object_guid')))
    idx = input('Select chat number: ').strip()
    try:
        idx = int(idx)
    except ValueError:
        print('Invalid number'); sys.exit(1)
    chat = chats[idx]
    object_guid = chat.get('object_guid') or chat.get('guid') or chat.get('id')
    contact_name = chat.get('title') or chat.get('name') or 'Contact'
    print('Selected:', contact_name, object_guid)

    print('Fetching messages (this may take a while for ~5000 msgs)...')
    all_msgs = []
    seen = set()
    cursor = 10**18
    empty_runs = 0
    while True:
        try:
            batch = get_messages(auth, object_guid, 'FromMax', cursor)
        except Exception as e:
            print('Request error:', e, '- retrying in 5s')
            time.sleep(5)
            continue
        if not batch:
            empty_runs += 1
            if empty_runs >= 2:
                break
            time.sleep(1)
            continue
        empty_runs = 0
        new_ids = []
        for m in batch:
            mid = msg_id(m)
            if mid is not None and mid in seen:
                continue
            if mid is not None:
                seen.add(mid)
            all_msgs.append(m)
            new_ids.append(mid)
        # advance cursor to smallest id in batch
        ids = [msg_id(m) for m in batch if msg_id(m) is not None]
        if ids:
            new_cursor = min(ids)
            if new_cursor >= cursor:
                # no progress; stop
                break
            cursor = new_cursor
        # sample print
        if len(all_msgs) <= 5 or len(all_msgs) % 500 == 0:
            print('  fetched so far:', len(all_msgs))
        time.sleep(0.6)
        if len(batch) < 5:
            # likely end
            pass

    # dedupe preserve order
    uniq = []
    seen2 = set()
    for m in all_msgs:
        mid = msg_id(m)
        key = mid if mid is not None else id(m)
        if key in seen2:
            continue
        seen2.add(key)
        uniq.append(m)
    all_msgs = uniq
    print('Total unique messages:', len(all_msgs))

    # save raw
    with open('shad_raw.json', 'w', encoding='utf-8') as f:
        json.dump(all_msgs, f, ensure_ascii=False, indent=2)
    print('Saved shad_raw.json')

    # normalize
    norm = []
    for m in all_msgs:
        norm.append({
            'id': msg_id(m),
            'type': 'message',
            'date': msg_time(m),
            'date_unixtime': None,
            'from': msg_from(m) or ('Me' if m.get('is_outgoing') else contact_name),
            'from_id': 'user_me' if m.get('is_outgoing') else 'user_contact',
            'text': msg_text(m),
            'reply_to_message_id': msg_reply(m),
        })

    # sort by id if numeric-ish
    try:
        norm.sort(key=lambda x: int(x['id']))
    except Exception:
        pass

    # JSON
    out = {'name': contact_name, 'type': 'personal_chat', 'id': object_guid, 'messages': norm}
    with open('shad_chat.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # CSV
    import csv
    with open('shad_chat.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['id', 'date', 'from', 'text', 'reply_to_message_id'])
        for m in norm:
            w.writerow([m['id'], m['date'], m['from'], m['text'], m['reply_to_message_id']])

    print('Saved shad_chat.json and shad_chat.csv')
    if norm:
        print('Sample message keys:', list(all_msgs[0].keys()))
        print('Sample normalized:', norm[0])


if __name__ == '__main__':
    main()
