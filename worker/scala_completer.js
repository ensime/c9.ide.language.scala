define(function(require, exports, module) {

  var baseHandler = require("plugins/c9.ide.language/base_handler");
  var workerUtil = require("plugins/c9.ide.language/worker_util");
  var util = require("./util");

  var handler = module.exports = Object.create(baseHandler);
  var emitter;

  handler.handlesLanguage = function(language) {
    return language === "scala";
  };

  handler.init = function(callback) {
    emitter = handler.getEmitter();
    console.log("Scala completer initialized.");
    callback();
  };

  function executeEnsime(req, callback) {
    util.executeEnsime(emitter, req, callback);
  }

  handler.complete = function(doc, ast, pos, options, callback) {
    console.info("Completion requested for " + handler.path);
    executeEnsime({
      typehint: "CompletionsReq",
      fileInfo: {
        file: handler.workspaceDir + handler.path,
        currentContents: true
      },
      point: util.posToOffset(doc, pos),
      maxResults: 30,
      caseSens: false,
      reload: true
    }, function(err, result) {
      if (err) return callback(err);
      var completions = result.completions.map(function(r, i) {
        return {
          id: r.typeId,
          name: r.name,
          replaceText: r.name,
          icon: r.isCallable ? "event" : "property",
          meta: r.typeSig.result,
          priority: r.relevance * 1000 + i,
          noDoc: true,
          isContextual: true,
          guessTooltip: false
        };
      });
      callback(completions);
    });
  };

  handler.predictNextCompletion = function(doc, ast, pos, options, callback) {
    //Trigger an update since our previous results should be refreshed from the server
    // -> higher quality, but more work for the server
    workerUtil.completeUpdate(pos, doc.getLine(pos.row));
  };
});