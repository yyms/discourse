// keep IIF for simpler testing

// EmberCompatHandlebars is a mechanism for quickly rendering templates which is Ember aware
// templates are highly compatible with Ember so you don't need to worry about calling "get"
// and computed properties function, additionally it uses stringParams like Ember does

(function(){

  // compat with ie8 in case this gets picked up elsewhere
  var objectCreate = Object.create || function(parent) {
    function F() {}
    F.prototype = parent;
    return new F();
  };


  var RawHandlebars = Handlebars.create();

  RawHandlebars.helper = function() {};
  RawHandlebars.helpers = objectCreate(Handlebars.helpers);

  RawHandlebars.helpers.get = function(context, options){
    var firstContext =  options.contexts[0];
    var val = firstContext[context];

    if (val && val.isDescriptor) { return Em.get(firstContext, context); }
    val = val === undefined ? Em.get(firstContext, context): val;
    return val;
  };

  // adds compatability so this works with stringParams
  var stringCompatHelper = function(fn){

    var old = RawHandlebars.helpers[fn];
    RawHandlebars.helpers[fn] = function(context,options){
      return old.apply(this, [
          RawHandlebars.helpers.get(context,options),
          options
      ]);
    };
  };

  // #each .. in support
  RawHandlebars.registerHelper('each', function(localName,inKeyword,contextName,options){
    var list = Em.get(this, contextName);
    var output = [];
    var innerContext = Object.create(this);
    for (var i=0; i<list.length; i++) {
      innerContext[localName] = list[i];
      output.push(options.fn(innerContext));
    }
    return output.join('');
  });

  stringCompatHelper("if");
  stringCompatHelper("unless");
  stringCompatHelper("with");


  if (Handlebars.Compiler) {
    RawHandlebars.Compiler = function() {};
    RawHandlebars.Compiler.prototype = objectCreate(Handlebars.Compiler.prototype);
    RawHandlebars.Compiler.prototype.compiler = RawHandlebars.Compiler;

    RawHandlebars.JavaScriptCompiler = function() {};

    RawHandlebars.JavaScriptCompiler.prototype = objectCreate(Handlebars.JavaScriptCompiler.prototype);
    RawHandlebars.JavaScriptCompiler.prototype.compiler = RawHandlebars.JavaScriptCompiler;
    RawHandlebars.JavaScriptCompiler.prototype.namespace = "Discourse.EmberCompatHandlebars";

    function replaceGet(ast) {
      var visitor = new Handlebars.Visitor();
      visitor.mutating = true;

      visitor.MustacheStatement = function(mustache) {
        if (!(mustache.params.length || mustache.hash)) {
          mustache.params[0] = mustache.path;
          mustache.path = {
            type: "PathExpression",
            data: false,
            depth: mustache.path.depth,
            parts: ["get"],
            original: "get",
            loc: mustache.path.loc,
            strict: true,
            falsy: true
          };
        }
        return Handlebars.Visitor.prototype.MustacheStatement.call(this, mustache);
      };
      visitor.accept(ast);
    }

    RawHandlebars.precompile = function(value, asObject) {
      var ast = Handlebars.parse(value);
      replaceGet(ast);

      var options = {
        knownHelpers: {
          get: true
        },
        data: true,
        stringParams: true
      };

      asObject = asObject === undefined ? true : asObject;

      var environment = new RawHandlebars.Compiler().compile(ast, options);
      return new RawHandlebars.JavaScriptCompiler().compile(environment, options, undefined, asObject);
    };

    RawHandlebars.compile = function(string) {
      var ast = Handlebars.parse(string);
      replaceGet(ast);

      // this forces us to rewrite helpers
      var options = {  data: true, stringParams: true };
      var environment = new RawHandlebars.Compiler().compile(ast, options);
      var templateSpec = new RawHandlebars.JavaScriptCompiler().compile(environment, options, undefined, true);

      var template = RawHandlebars.template(templateSpec);
      template.isMethod = false;

      return template;
    };
  }

  RawHandlebars.get = function(ctx, property, options){
    if (options.types && options.data.view) {
      return options.data.view.getStream(property).value();
    } else {
      return Ember.get(ctx, property);
    }
  };

  Discourse.EmberCompatHandlebars = RawHandlebars;

})();
