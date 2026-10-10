"""List every captured request URL and status for triage."""
from mitmproxy import ctx


def response(flow):
    ctx.log.info('%s %s -> %s' % (flow.request.method, flow.request.pretty_url[:140],
                                  flow.response.status_code if flow.response else 'NO RESP'))