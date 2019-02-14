const {t, checkScheme} = ChromeUtils.import('chrome://juggler/content/PrimitiveTypes.js');

// Protocol-specific types.
const types = {};

const Browser = {
  events: {
    'tabOpened': {
      pageId: t.String,
      browserContextId: t.Optional(t.String),
      url: t.String,
      // PageId of parent tab.
      openerId: t.Optional(t.String),
    },
    'tabClosed': { pageId: t.String, },
    'tabNavigated': {
      pageId: t.String,
      url: t.String
    },
  },

  methods: {
    // Start emitting tagOpened/tabClosed events
    'enable': {},
    'getInfo': {
      returns: {
        userAgent: t.String,
        version: t.String,
      },
    },
    'setIgnoreHTTPSErrors': {
      params: {
        enabled: t.Boolean,
      },
    },
    'newPage': {
      params: {
        browserContextId: t.Optional(t.String),
      },
      returns: {
        pageId: t.String,
      }
    },
    'closePage': {
      params: {
        pageId: t.String,
        runBeforeUnload: t.Optional(t.Boolean),
      },
    },
    'createBrowserContext': {
      returns: {
        browserContextId: t.String,
      },
    },
    'removeBrowserContext': {
      params: {
        browserContextId: t.String,
      },
    },
    'getBrowserContexts': {
      returns: {
        browserContextIds: t.Array(t.String),
      },
    },
  },
};

types.DOMPoint = {
  x: t.Number,
  y: t.Number,
};

types.DOMQuad = {
  p1: types.DOMPoint,
  p2: types.DOMPoint,
  p3: types.DOMPoint,
  p4: types.DOMPoint,
};

types.RemoteObject = t.Either({
  type: t.Enum(['object', 'function', 'undefined', 'string', 'number', 'boolean', 'symbol', 'bigint']),
  subtype: t.Optional(t.Enum(['array', 'null', 'node', 'regexp', 'date', 'map', 'set', 'weakmap', 'weakset', 'error', 'proxy', 'promise', 'typedarray'])),
  objectId: t.String,
}, {
  unserializableValue: t.Enum(['Infinity', '-Infinity', '-0', 'NaN']),
}, {
  value: t.Any
});

const Page = {
  events: {
    'eventFired': {
      pageId: t.String,
      frameId: t.String,
      name: t.Enum(['load', 'DOMContentLoaded']),
    },
    'uncaughtError': {
      pageId: t.String,
      frameId: t.String,
      message: t.String,
      stack: t.String,
    },
    'frameAttached': {
      pageId: t.String,
      frameId: t.String,
      parentFrameId: t.Optional(t.String),
    },
    'frameDetached': {
      pageId: t.String,
      frameId: t.String,
    },
    'navigationStarted': {
      pageId: t.String,
      frameId: t.String,
      navigationId: t.String,
      url: t.String,
    },
    'navigationCommitted': {
      pageId: t.String,
      frameId: t.String,
      navigationId: t.String,
      url: t.String,
      // frame.id or frame.name
      name: t.String,
    },
    'navigationAborted': {
      pageId: t.String,
      frameId: t.String,
      navigationId: t.String,
      errorText: t.String,
    },
    'sameDocumentNavigation': {
      pageId: t.String,
      frameId: t.String,
      url: t.String,
    },
    'console': {
      pageId: t.String,
      frameId: t.String,
      args: t.Array(types.RemoteObject),
      type: t.String,
      location: {
        columnNumber: t.Number,
        lineNumber: t.Number,
        url: t.String,
      },
    },
    'dialogOpened': {
      pageId: t.String,
      dialogId: t.String,
      type: t.Enum(['prompt', 'alert', 'confirm', 'beforeunload']),
      message: t.String,
      defaultValue: t.Optional(t.String),
    },
    'dialogClosed': {
      pageId: t.String,
      dialogId: t.String,
    },
    'requestWillBeSent': {
      pageId: t.String,
      // frameId may be absent for redirected requests.
      frameId: t.Optional(t.String),
      requestId: t.String,
      // RequestID of redirected request.
      redirectedFrom: t.Optional(t.String),
      postData: t.Optional(t.String),
      headers: t.Array({
        name: t.String,
        value: t.String,
      }),
      url: t.String,
      method: t.String,
      isNavigationRequest: t.Boolean,
      cause: t.String,
    },
    'responseReceived': {
      securityDetails: t.Nullable({
        protocol: t.String,
        subjectName: t.String,
        issuer: t.String,
        validFrom: t.Number,
        validTo: t.Number,
      }),
      pageId: t.String,
      requestId: t.String,
      fromCache: t.Boolean,
      remoteIPAddress: t.String,
      remotePort: t.Number,
      status: t.Number,
      statusText: t.String,
      headers: t.Array({
        name: t.String,
        value: t.String,
      }),
    },
    'requestFinished': {
      pageId: t.String,
      requestId: t.String,
      errorCode: t.Optional(t.String),
    },
  },

  methods: {
    'enable': {
      params: {
        pageId: t.String,
      },
    },
    'setViewport': {
      params: {
        pageId: t.String,
        viewport: t.Nullable({
          width: t.Number,
          height: t.Number,
          deviceScaleFactor: t.Number,
          isMobile: t.Boolean,
          hasTouch: t.Boolean,
          isLandscape: t.Boolean,
        }),
      },
    },
    'setUserAgent': {
      params: {
        pageId: t.String,
        userAgent: t.Nullable(t.String),
      },
    },
    'setCacheDisabled': {
      params: {
        pageId: t.String,
        cacheDisabled: t.Boolean,
      },
    },
    'setJavascriptEnabled': {
      params: {
        pageId: t.String,
        enabled: t.Boolean,
      },
    },
    'contentFrame': {
      params: {
        pageId: t.String,
        frameId: t.String,
        objectId: t.String,
      },
      returns: {
        frameId: t.Nullable(t.String),
      },
    },
    'evaluate': {
      params: t.Either({
        pageId: t.String,
        // Pass frameId here.
        executionContextId: t.String,
        functionText: t.String,
        returnByValue: t.Optional(t.Boolean),
        args: t.Array(t.Either(
          { objectId: t.String },
          { unserializableValue: t.Enum(['Infinity', '-Infinity', '-0', 'NaN']) },
          { value: t.Any },
        )),
      }, {
        pageId: t.String,
        // Pass frameId here.
        executionContextId: t.String,
        script: t.String,
        returnByValue: t.Optional(t.Boolean),
      }),

      returns: {
        result: t.Optional(types.RemoteObject),
        exceptionDetails: t.Optional({
          text: t.Optional(t.String),
          stack: t.Optional(t.String),
          value: t.Optional(t.Any),
        }),
      }
    },
    'addScriptToEvaluateOnNewDocument': {
      params: {
        pageId: t.String,
        script: t.String,
      },
      returns: {
        scriptId: t.String,
      }
    },
    'removeScriptToEvaluateOnNewDocument': {
      params: {
        pageId: t.String,
        scriptId: t.String,
      },
    },
    'disposeObject': {
      params: {
        pageId: t.String,
        executionContextId: t.String,
        objectId: t.String,
      },
    },

    'getObjectProperties': {
      params: {
        pageId: t.String,
        executionContextId: t.String,
        objectId: t.String,
      },

      returns: {
        properties: t.Array({
          name: t.String,
          value: types.RemoteObject,
        }),
      }
    },
    'navigate': {
      params: {
        pageId: t.String,
        frameId: t.String,
        url: t.String,
        referer: t.Optional(t.String),
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'goBack': {
      params: {
        pageId: t.String,
        frameId: t.String,
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'goForward': {
      params: {
        pageId: t.String,
        frameId: t.String,
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'reload': {
      params: {
        pageId: t.String,
        frameId: t.String,
      },
      returns: {
        navigationId: t.String,
        navigationURL: t.String,
      }
    },
    'getBoundingBox': {
      params: {
        pageId: t.String,
        frameId: t.String,
        objectId: t.String,
      },
      returns: t.Nullable({
        x: t.Number,
        y: t.Number,
        width: t.Number,
        height: t.Number,
      }),
    },
    'screenshot': {
      params: {
        pageId: t.String,
        mimeType: t.Enum(['image/png', 'image/jpeg']),
        fullPage: t.Optional(t.Boolean),
        clip: t.Optional({
          x: t.Number,
          y: t.Number,
          width: t.Number,
          height: t.Number,
        })
      },
      returns: {
        data: t.String,
      }
    },
    'getContentQuads': {
      params: {
        pageId: t.String,
        frameId: t.String,
        objectId: t.String,
      },
      returns: {
        quads: t.Array(types.DOMQuad),
      },
    },
    'dispatchKeyEvent': {
      params: {
        pageId: t.String,
        type: t.String,
        key: t.String,
        keyCode: t.Number,
        location: t.Number,
        code: t.String,
        repeat: t.Boolean,
      }
    },
    'dispatchMouseEvent': {
      params: {
        pageId: t.String,
        type: t.String,
        button: t.Number,
        x: t.Number,
        y: t.Number,
        modifiers: t.Number,
        clickCount: t.Optional(t.Number),
        buttons: t.Number,
      }
    },
    'insertText': {
      params: {
        pageId: t.String,
        text: t.String,
      }
    },
    'handleDialog': {
      params: {
        pageId: t.String,
        dialogId: t.String,
        accept: t.Boolean,
        promptText: t.Optional(t.String),
      },
    },
  },
};

this.protocol = {
  domains: {Browser, Page},
};
this.checkScheme = checkScheme;
this.EXPORTED_SYMBOLS = ['protocol', 'checkScheme'];
