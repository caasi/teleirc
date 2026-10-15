'use strict';

var assert = require('assert');

require('./helpers/sandbox');

var ircUtil = require('../src/irc/util');

// Each case is [input, expected]. The expected values are what parseUrl
// returned when these tests were written. The inputs come from a manual
// check script kept on the production host since 2018.
var cases = require('./parse-url-cases.json');

describe('irc/util parseUrl', function() {
    cases.forEach(function(c) {
        it('simplifies ' + c[1].type + ': ' + c[1].url, function() {
            assert.deepStrictEqual(ircUtil.parseUrl(c[0]), c[1]);
        });
    });
});
