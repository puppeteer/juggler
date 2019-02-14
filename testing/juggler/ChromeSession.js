const {BrowserHandler} = ChromeUtils.import("chrome://juggler/content/BrowserHandler.jsm");
const {protocol, checkScheme} = ChromeUtils.import("chrome://juggler/content/Protocol.js");

class ChromeSession {
  /**
   * @param {Connection} connection
   * @param {Ci.nsIDOMChromeWindow} mainWindow
   * @param {BrowserContextManager} contextManager
   * @param {NetworkObserver} networkObserver
   */
  constructor(connection, mainWindow, contextManager, networkObserver) {
    this._connection = connection;
    this._connection.onmessage = this._dispatch.bind(this);

    this._browserHandler = new BrowserHandler(this, mainWindow, contextManager, networkObserver);
  }

  emitEvent(eventName, params) {
    const [domain, eName] = eventName.split('.');
    const scheme = protocol.domains[domain] ? protocol.domains[domain].events[eName] : null;
    if (!scheme)
      throw new Error(`ERROR: event '${eventName}' is not supported`);
    const details = {};
    if (!checkScheme(scheme, params || {}, details))
      throw new Error(`ERROR: failed to emit event '${eventName}' ${JSON.stringify(params, null, 2)}\n${details.error}`);
    this._connection.send({method: eventName, params});
  }

  async _dispatch(data) {
    const id = data.id;
    try {
      const method = data.method;
      const params = data.params || {};
      if (!id)
        throw new Error(`ERROR: every message must have an 'id' parameter`);
      if (!method)
        throw new Error(`ERROR: every message must have a 'method' parameter`);

      const [domain, methodName] = method.split('.');
      const descriptor = protocol.domains[domain] ? protocol.domains[domain].methods[methodName] : null;
      if (!descriptor)
        throw new Error(`ERROR: method '${method}' is not supported`);
      let details = {};
      if (!checkScheme(descriptor.params || {}, params, details))
        throw new Error(`ERROR: failed to call method '${method}' with parameters ${JSON.stringify(params, null, 2)}\n${details.error}`);

      const result = await this._innerDispatch(method, params);

      details = {};
      if ((descriptor.returns || result) && !checkScheme(descriptor.returns, result, details))
        throw new Error(`ERROR: failed to dispatch method '${method}' result ${JSON.stringify(result, null, 2)}\n${details.error}`);

      this._connection.send({id, result});
    } catch (e) {
      this._connection.send({id, error: {
        message: e.message,
        data: e.stack
      }});
    }
  }

  async _innerDispatch(method, params) {
    const [domainName, methodName] = method.split('.');
    if (domainName === 'Browser')
      return await this._browserHandler[methodName](params);
    if (domainName === 'Page') {
      if (!params.pageId)
        throw new Error('Parameter "pageId" must be present for Page.* methods');
      const pageHandler = this._browserHandler.pageForId(params.pageId);
      if (!pageHandler)
        throw new Error('Failed to find page for id = ' + pageId);
      return await pageHandler[methodName](params);
    }
    throw new Error(`INTERNAL ERROR: failed to dispatch '${method}'`);
  }
}

this.EXPORTED_SYMBOLS = ['ChromeSession'];
this.ChromeSession = ChromeSession;

