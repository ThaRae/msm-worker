"""Print every flow's request/response detail (mitmdump addon)."""
from mitmproxy import ctx


def response(flow):
    ctx.log.info('=== %s %s' % (flow.request.method, flow.request.pretty_url))
    ctx.log.info('REQ HDRS %s' % str(dict(flow.request.headers)))
    ctx.log.info('REQ BODY %s' % (flow.request.get_text() or '')[:800])
    if flow.response:
        ctx.log.info('STATUS %d' % flow.response.status_code)
        ctx.log.info('RESP HDRS %s' % str(dict(flow.response.headers)))
        ctx.log.info('RESP %s' % (flow.response.get_text() or '')[:1500])