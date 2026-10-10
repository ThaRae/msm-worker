"""mitmproxy addon: dump websocket handshake headers and raw frames from flows.mitm"""

def request(flow):
    if flow.request.path.endswith('/msm/socket') or 'socket' in flow.request.path:
        print(f"WS-REQ {flow.request.method} {flow.request.pretty_url}")
        for k, v in flow.request.headers.items():
            print(f"  REQH {k}: {v}")

def response(flow):
    if 'socket' in flow.request.path:
        print(f"WS-RESP {flow.response.status_code}")
        for k, v in flow.response.headers.items():
            print(f"  RESPH {k}: {v}")

def websocket_start(flow):
    print(f"WS-START {flow.client_conn.sni or ''}")

def websocket_message(flow):
    msg = flow.websocket.latest_message
    direction = 'S->C' if msg.from_client is False else 'C->S'
    content = msg.content
    if isinstance(content, bytes):
        print(f"WS-MSG {direction} {len(content)} bytes: {content.hex()[:400]}")
    else:
        print(f"WS-MSG {direction} text: {content!r}"[:400])

def websocket_end(flow):
    print("WS-END")