// Generated by CoffeeScript 1.3.3
(function() {
  var $, SeoServer, express, logentries, memcached,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  express = require('express');

  memcached = require('memcached');

  $ = require('jquery');

  logentries = require('node-logentries');

  SeoServer = (function() {

    SeoServer.prototype.config = {
      host: 'http://moviepilot.com',
      default_port: 10300,
      memcached: {
        enabled: true,
        default_host: 'localhost',
        default_port: 11211,
        max_value: 2097152,
        connect_retries: 5,
        key: 'moviepilot.com'
      },
      logentries: {
        enabled: true,
        token: '25ebab68-8d2f-4382-a28c-7ed0a3cd255e'
      }
    };

    function SeoServer() {
      this.deliverResponse = __bind(this.deliverResponse, this);

      this.setCache = __bind(this.setCache, this);

      this.responseHandler = __bind(this.responseHandler, this);

      this.startServer = __bind(this.startServer, this);

      var _this = this;
      memcached = this.initMemcached();
      memcached.fail(function(error) {
        return console.log(error);
      });
      memcached.done(function(connection) {
        return console.log("Connected to memcached");
      });
      memcached.always(function() {
        return _this.startServer();
      });
    }

    SeoServer.prototype.startServer = function() {
      console.log("Express server started at port " + this.config.default_port);
      this.app = express();
      this.app.get(/(.*)/, this.responseHandler);
      return this.app.listen(this.config.default_port);
    };

    SeoServer.prototype.responseHandler = function(request, response) {
      this.timer = 0;
      this.now = +new Date();
      return this.fetchPage(request, response).done(this.deliverResponse);
    };

    SeoServer.prototype.fetchPage = function(request, response) {
      var dfd, fetchDfd, url,
        _this = this;
      dfd = $.Deferred();
      url = this.config.host + request.url;
      if (this.memcachedClient) {
        fetchDfd = this.fetchFromMemcached(request, response);
      } else {
        fetchDfd = this.fetchFromPhantom(url);
      }
      fetchDfd.done(function(url, response, headers, content) {
        _this.setCache(request, headers, content);
        return dfd.resolve(url, response, headers, content);
      });
      return dfd.promise();
    };

    SeoServer.prototype.setCache = function(request, headers, content) {
      var key, uri;
      if (!this.memcachedClient) {
        return;
      }
      if (headers.status === 301) {
        content = "301 " + headers.location;
      }
      uri = this.config.host + request.path;
      key = this.config.memcached.key + uri;
      if (headers.status >= 200 && (headers.status < 300 || headers.status === 301)) {
        return this.memcachedClient.set(key, content, 0, function(err) {
          return console.log(err);
        });
      }
    };

    SeoServer.prototype.deliverResponse = function(url, response, headers, content) {
      response.status(headers.status || 500);
      response.header("Access-Control-Allow-Origin", "*");
      response.header("Access-Control-Allow-Headers", "X-Requested-With");
      if (headers.location != null) {
        response.set('Location', headers.location);
        return response.send('');
      } else {
        console.log(content);
        return response.send(content);
      }
    };

    SeoServer.prototype.fetchFromMemcached = function(request, response) {
      var clearCache, dfd, key, uri, url,
        _this = this;
      dfd = $.Deferred();
      url = this.config.host + request.url;
      uri = this.config.host + request.path;
      key = this.config.memcached.key + uri;
      clearCache = request.query.plan === 'titanium';
      this.memcachedClient.get(key, function(error, cachedContent) {
        var headers, matches;
        if (error) {
          return dfd.reject("memcached error: " + error);
        }
        if (cachedContent && !clearCache) {
          headers = {};
          if (/^301/.test(cachedContent)) {
            matches = cachedContent.match(/\s(.*)$/);
            response.status(301);
            headers.location = matches[1];
          }
          return dfd.resolve(url, response, headers, cachedContent);
        } else {
          return _this.fetchFromPhantom(url).done(dfd.resolve);
        }
      });
      return dfd.promise();
    };

    SeoServer.prototype.fetchFromPhantom = function(url) {
      var content, dfd, headers, phantom, timeout,
        _this = this;
      dfd = $.Deferred();
      timeout = null;
      headers = {};
      content = '';
      phantom = require('child_process').spawn('phantomjs', [__dirname + '/phantom-server.js', url]);
      timeout = setTimeout(function() {
        return phantom.kill();
      }, 30000);
      phantom.stdout.on('data', function(data) {
        var match, response;
        data = data.toString();
        if (match = data.match(/({.*?})\n\n/)) {
          response = JSON.parse(match[1]);
          if (!headers.status) {
            headers.status = response.status;
          }
          if (response.status === 301) {
            headers.location = response.redirectURL;
          }
          data = data.replace(/(.*?)\n\n/, '');
        }
        if (data.match(/^\w*error/i)) {
          headers.status = 503;
          return console.log("Phantom js error: " + data.toString());
        } else {
          return content += data.toString();
        }
      });
      phantom.stderr.on('data', function(data) {
        return console.log('stderr: ' + data);
      });
      phantom.on('exit', function(code) {
        clearTimeout(timeout);
        if (code) {
          console.log('Error on Phantomjs process');
          return dfd.fail();
        } else {
          content = _this.removeScriptTags(content);
          return dfd.resolve(url, {}, headers, content);
        }
      });
      return dfd.promise();
    };

    SeoServer.prototype.initMemcached = function() {
      var client, dfd, server,
        _this = this;
      dfd = $.Deferred();
      if (!this.config.memcached.enabled) {
        dfd.reject('memcached is disabled');
        return dfd.promise();
      }
      memcached.config.retries = this.config.memcached.connect_retries;
      memcached.config.maxValue = this.config.memcached.max_value;
      server = "" + this.config.memcached.default_host + ":" + this.config.memcached.default_port;
      client = new memcached(server);
      client.on('failure', function(details) {
        var error;
        error = "Memcached connection failure on: " + details.server + "        due to: " + (details.messages.join(' '));
        return dfd.reject(error);
      });
      client.on('reconnecting', function(details) {
        return console.log("memcached: Total downtime caused by server       " + details.server + " : " + details.totalDownTime + " ms");
      });
      console.log("Trying to connect to memcached server " + server);
      client.connect(server, function(error, connection) {
        if (error) {
          return dfd.reject(error);
        } else {
          _this.memcachedClient = client;
          return dfd.resolve();
        }
      });
      return dfd.promise();
    };

    SeoServer.prototype.logResponse = function() {
      var crawler;
      return crawler = /RedSnapper/.test(request.headers['user-agent']) ? 'Crawler' : 'GoogleBot';
    };

    SeoServer.prototype.removeScriptTags = function(content) {
      return content.replace(/<script[\s\S]*?<\/script>/gi, '');
    };

    return SeoServer;

  })();

  new SeoServer();

}).call(this);