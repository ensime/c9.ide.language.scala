var Controller = require("ensime-controller-js");
var fs = require("fs");
var path = require("path");


if (process.argv.length < 4) {
  return console.error("Specify the .ensime file  and the location of sbt as command line argument.");
}
var dotEnsime = process.argv[2];
var sbt = process.argv[3];
var allowAttach = false;
if (process.argv.length > 4) allowAttach = process.argv[4] == "true";

var workspace = path.dirname(dotEnsime);
var logfile = path.relative(workspace, ".ensime_cache/ensime.log");
var log = fs.createWriteStream(logfile);
var output = {
  out: log,
  err: log
};

// keep the stdout clean since we need it for messages.
console.log = console.info = console.debug = console.warn = function(message) {
  if (message) output.out.write(message.toString() + "\n");
};



var ec = new Controller(dotEnsime, "/tmp/ensime", {
  sbt: sbt
});

process.stdout.setEncoding("ascii");
process.stdin.setEncoding("ascii");

ec.handleGeneral = function(msg) {
  var string = JSON.stringify(msg);
  process.stdout.write(utoa(string) + "|");
};

function utoa(str) {
  var buffer = new Buffer(encodeURIComponent(str), "binary");
  return buffer.toString("base64");
}

function atou(str) {
  var buffer = new Buffer(str, "base64");
  return decodeURIComponent(buffer.toString("binary"));
}

function start() {
  ec.connect(output, function(err, res) {
    if (err) return console.error(err);
    connected(res);
    console.info("========= ENSIME is now running ============\n");
  });
}

function attach() {
  ec.attach(function(err, res) {
    if (err) {
      console.info("Attach failed, starting new instance.");
      return start(); // start if we cannot attach
    }
    console.info("Attach successful, gut a response: " + JSON.stringify(res));
    connected(res);
    console.info("========= Attached to running ENSIME ============\n");
  });
}

function connected(res) {
  process.stdin.on("error", function(err) {
    console.error("Error reading from stdin: " + err);
    process.exit(4);
  });
  process.stdin.on("data", receivedData);

  ec.handleGeneral({
    type: "started",
    port: res.ports.http
  });
}

var buffer = "";

function receivedData(chunk) {
  buffer += chunk;
  var delim = buffer.indexOf("|");
  if (delim == -1) return;

  var decoded = atou(buffer.substr(0, delim));
  buffer = buffer.substr(delim + 1);
  var req = JSON.parse(decoded);
  handleRequest(req);
  receivedData("");
}

function handleRequest(req) {
  ec.send(req, function(err, resp) {
    var msg = {
      type: "callResponse",
      callId: req.callId
    };
    if (err) msg.error = err;
    else msg.response = resp;
    ec.handleGeneral(msg);
  });
}


if (allowAttach) {
  console.info("Checking for running instance...");
  attach();
}
else {
  start();
}
