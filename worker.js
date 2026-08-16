const SHELL_ROUTE = /^\/(?:$|todo-list-ui\/?$|chat-ui\/?$|chat-ui\/chat\/[^/]+\/?$)/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && SHELL_ROUTE.test(url.pathname)) {
      const shellUrl = new URL('/index.html', url.origin);
      const shellRequest = new Request(shellUrl, request);
      return env.ASSETS.fetch(shellRequest);
    }

    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
};
