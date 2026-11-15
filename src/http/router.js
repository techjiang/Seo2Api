/** 极简路由器：支持 /path/:param 与通配，零依赖、无正则回溯风险 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((seg) => {
        if (!seg) return '';
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        if (seg === '*') {
          keys.push('wildcard');
          return '(.*)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      regex: new RegExp(`^${source}/?$`),
      keys,
      handler,
      options,
    });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }
  head(p, h, o) { return this.add('HEAD', p, h, o); }

  match(method, pathname) {
    const upper = method.toUpperCase();
    const allow = new Set();
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      allow.add(route.method);
      if (route.method !== upper && !(upper === 'HEAD' && route.method === 'GET')) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] ?? ''); });
      return { route, params, query: new URLSearchParams(pathname.includes('?') ? pathname.split('?')[1] : '') };
    }
    return { route: null, params: {}, allow: [...allow] };
  }
}
