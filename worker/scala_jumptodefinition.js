define(function(require, exports, module) {

  var baseHandler = require("plugins/c9.ide.language/base_handler");
  var workerUtil = require("plugins/c9.ide.language/worker_util");
  var util = require("./util");
  var path = require("/static/lib/path");

  var handler = module.exports = Object.create(baseHandler);
  var emitter;


  handler.handlesLanguage = function(language) {
    return language === "scala";
  };

  handler.init = function(callback) {
    emitter = handler.getEmitter();
    console.log("Scala jump-to-definition initialized.");

    if (!handler.workspaceDir) {
      handler.workspaceDir = "/home/ubuntu/workspace";
      console.warn("WorkspaceDir was undefined in the language handler - setting it to " + handler.workspaceDir);
    }
    callback();
  };

  function executeEnsime(req, callback) {
    util.executeEnsime(emitter, req, callback);
  }

  handler.jumpToDefinition = function(doc, ast, pos, options, callback) {
    console.info("Jump to definition for " + options.path + ":" + JSON.stringify(pos));

    executeEnsime({
      typehint: "SymbolAtPointReq",
      file: {
        file: handler.workspaceDir + options.path,
        contents: doc.getValue(),
        currentContents: true
      },
      point: util.posToOffset(doc, pos)
    }, function(err, symbol) {
      if (err) {
        console.warn("Error fetching jumping to definition (SymbolAtPointReq).");
        return callback(err);
      }
      if (symbol.typehint !== "SymbolInfo") return callback(false, []);

      if (symbol.declPos.typehint === "LineSourcePosition") {
        callback(false, [{
          path: symbol.declPos.file,
          row: symbol.declPos.line,
          column: 0,
          isGeneric: false
        }]);
      }
      else if (symbol.declPos.typehint === "OffsetSourcePosition") {
        var file = path.relative(handler.workspaceDir, symbol.declPos.file);
        workerUtil.readFile(file, {
          encoding: "utf-8",
          allowUnsaved: true
        }, function(err, contents) {
          if (err) {
            console.warn("Failed to read " + symbol.declPos.file);
            return callback(err);
          }

          var before = contents.substring(0, symbol.declPos.offset);
          var line = (before.match(/\n/g) || []).length;
          var column = Math.max(0, before.length - before.lastIndexOf('\n') - 1);
          callback(false, [{
            path: symbol.declPos.file,
            row: line,
            column: column,
            isGeneric: false
          }]);
        });
      }
      else {
        callback(false, []);
      }
    });
  };
});