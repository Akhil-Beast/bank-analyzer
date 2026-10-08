import urllib.request
import uuid

url = 'http://localhost:8000/api/v1/upload'
file_path = r'D:\Acct_Statement_XXXXXXXX2804_08102026 (2)_unlocked.pdf'

boundary = uuid.uuid4().hex
headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}

with open(file_path, 'rb') as f:
    file_bytes = f.read()

prefix = (
    f'--{boundary}\r\n'
    f'Content-Disposition: form-data; name="file"; filename="Acct_Statement_XXXXXXXX2804.pdf"\r\n'
    f'Content-Type: application/pdf\r\n\r\n'
).encode('utf-8')

suffix = f'\r\n--{boundary}--\r\n'.encode('utf-8')
body = prefix + file_bytes + suffix

req = urllib.request.Request(url, data=body, headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print('Status:', resp.status)
        print('Response:', resp.read().decode())
except urllib.error.HTTPError as e:
    print('HTTPError:', e.code, e.read().decode())
except Exception as e:
    print('Error:', e)
