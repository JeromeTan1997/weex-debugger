const Router = require("koa-router");
const MemoryFile = require("../../MemoryFile");
const mlink = require("../../link");
const DeviceManager = require("../../link/managers/device_manager");
const URL = require("url");
const config = require("../../config");
const protocols = {
  "http:": require("http"),
  "https:": require("https")
};
const { logger, bundleWrapper } = require("../../util");

const httpRouter = new Router();

function getRemote(url) {
  return new Promise(function(resolve, reject) {
    const urlObj = URL.parse(url);
    (protocols[urlObj.protocol] || protocols["http:"])
      .get(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.path,
          method: "GET",
          headers: {
            "User-Agent": "Weex/1.0.0"
          }
        },
        function(res) {
          let chunks = [];
          res.on("data", function(chunk) {
            chunks.push(chunk);
          });
          res.on("end", function() {
            resolve(Buffer.concat(chunks).toString());
            chunks = null;
          });
        }
      )
      .on("error", function(e) {
        reject(e);
      });
  });
}
const rSourceMapDetector = /\.map$/;
httpRouter.get("/source/*", function*(next) {
  const path = this.params[0];
  if (rSourceMapDetector.test(path)) {
    logger.verbose(`Fetch sourcemap ${path}`);
    const content = yield getRemote("http://" + path);
    if (!content) {
      this.response.status = 404;
    } else {
      this.response.status = 200;
      this.response["content-type"] = "text/javascript";
      this.set("Access-Control-Allow-Origin", "*");
      this.response.body = content;
    }
  } else {
    let query = this.request.url.split("?");
    query = query[1] ? "?" + query.slice(1).join("?") : "";
    const file = MemoryFile.get(path + query);
    if (file) {
      this.response.status = 200;
      this.response["content-type"] = "text/javascript";
      if (file.url && config.proxy) {
        logger.verbose(`Fetch jsbundle ${file.url}`);
        const content = yield getRemote(file.url).catch(function(e) {
          // If file not found or got other http error.
          logger.verbose(e);
        });
        if (!content) {
          this.response.body = file.getContent();
        } else {
          this.response.body = bundleWrapper(content, file.getUrl());
        }
      } else {
        this.response.body = file.getContent();
      }
    } else {
      this.response.status = 404;
    }
  }
});

let syncApiIndex = 0;
const SyncTerminal = mlink.Terminal.SyncTerminal;
const syncHub = mlink.Hub.get("sync");
httpRouter.post("/syncApi", function*() {
  const idx = syncApiIndex++;
  const payload = this.request.body;
  const device = DeviceManager.getDevice(payload.channelId);
  if (device) {
    const terminal = new SyncTerminal();
    terminal.channelId = payload.channelId;
    syncHub.join(terminal, true);
    payload.params.syncId = 100000 + idx;
    payload.id = 100000 + idx;
    const data = yield terminal.send(payload);
    this.response.status = 200;
    this.type = "application/json";
    this.response.body = JSON.stringify(data);
  } else {
    this.response.status = 500;
    // this.response.body = JSON.stringify({ error: 'device not found!' });
  }
});
module.exports = httpRouter;
