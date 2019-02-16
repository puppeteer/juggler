const {t, checkScheme} = ChromeUtils.import('chrome://juggler/content/PrimitiveTypes.js');

// Protocol-specific types.
const types = {};

const Browser = {
  events: {
    'targetCreated': {
      targetId: t.String,
      browserContextId: t.Optional(t.String),
      url: t.String,
      // PageId of parent tab.
      openerId: t.Optional(t.String),
    },
    'targetDestroyed': { targetId: t.String, },
    'targetChanged': {
      targetId: t.String,
      url: t.String
    },
  },

  methods: {
    // Start emitting tagOpened/tabClosed events
    'enable': {},
    'close': {},
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
        targetId: t.String,
      }
    },
    'closePage': {
      params: {
        targetId: t.String,
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

const Network = {
  events: {
    'requestWillBeSent': {
      targetId: t.String,
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
      targetId: t.String,
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
      targetId: t.String,
      requestId: t.String,
      errorCode: t.Optional(t.String),
    },
  },
  methods: {
  },
};

const Page = {
  events: {
    'eventFired': {
      targetId: t.String,
      frameId: t.String,
      name: t.Enum(['load', 'DOMContentLoaded']),
    },
    'uncaughtError': {
      targetId: t.String,
      frameId: t.String,
      message: t.String,
      stack: t.String,
    },
    'frameAttached': {
      targetId: t.String,
      frameId: t.String,
      parentFrameId: t.Optional(t.String),
    },
    'frameDetached': {
      targetId: t.String,
      frameId: t.String,
    },
    'navigationStarted': {
      targetId: t.String,
      frameId: t.String,
      navigationId: t.String,
      url: t.String,
    },
    'navigationCommitted': {
      targetId: t.String,
      frameId: t.String,
      navigationId: t.String,
      url: t.String,
      // frame.id or frame.name
      name: t.String,
    },
    'navigationAborted': {
      targetId: t.String,
      frameId: t.String,
      navigationId: t.String,
      errorText: t.String,
    },
    'sameDocumentNavigation': {
      targetId: t.String,
      frameId: t.String,
      url: t.String,
    },
    'console': {
      targetId: t.String,
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
      targetId: t.String,
      dialogId: t.String,
      type: t.Enum(['prompt', 'alert', 'confirm', 'beforeunload']),
      message: t.String,
      defaultValue: t.Optional(t.String),
    },
    'dialogClosed': {
      targetId: t.String,
      dialogId: t.String,
    },
  },

  methods: {
    'enable': {
      params: {
        targetId: t.String,
      },
    },
    'setViewport': {
      params: {
        targetId: t.String,
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
        targetId: t.String,
        userAgent: t.Nullable(t.String),
      },
    },
    'setCacheDisabled': {
      params: {
        targetId: t.String,
        cacheDisabled: t.Boolean,
      },
    },
    'setJavascriptEnabled': {
      params: {
        targetId: t.String,
        enabled: t.Boolean,
      },
    },
    'contentFrame': {
      params: {
        targetId: t.String,
        frameId: t.String,
        objectId: t.String,
      },
      returns: {
        frameId: t.Nullable(t.String),
      },
    },
    'evaluate': {
      params: t.Either({
        targetId: t.String,
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
        targetId: t.String,
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
        targetId: t.String,
        script: t.String,
      },
      returns: {
        scriptId: t.String,
      }
    },
    'removeScriptToEvaluateOnNewDocument': {
      params: {
        targetId: t.String,
        scriptId: t.String,
      },
    },
    'disposeObject': {
      params: {
        targetId: t.String,
        executionContextId: t.String,
        objectId: t.String,
      },
    },

    'getObjectProperties': {
      params: {
        targetId: t.String,
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
        targetId: t.String,
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
        targetId: t.String,
        frameId: t.String,
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'goForward': {
      params: {
        targetId: t.String,
        frameId: t.String,
      },
      returns: {
        navigationId: t.Nullable(t.String),
        navigationURL: t.Nullable(t.String),
      }
    },
    'reload': {
      params: {
        targetId: t.String,
        frameId: t.String,
      },
      returns: {
        navigationId: t.String,
        navigationURL: t.String,
      }
    },
    'getBoundingBox': {
      params: {
        targetId: t.String,
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
        targetId: t.String,
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
        targetId: t.String,
        frameId: t.String,
        objectId: t.String,
      },
      returns: {
        quads: t.Array(types.DOMQuad),
      },
    },
    'dispatchKeyEvent': {
      params: {
        targetId: t.String,
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
        targetId: t.String,
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
        targetId: t.String,
        text: t.String,
      }
    },
    'handleDialog': {
      params: {
        targetId: t.String,
        dialogId: t.String,
        accept: t.Boolean,
        promptText: t.Optional(t.String),
      },
    },
  },
};

this.protocol = {
  domains: {Browser, Page, Network},
};
this.checkScheme = checkScheme;
this.EXPORTED_SYMBOLS = ['protocol', 'checkScheme'];
