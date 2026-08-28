/**
 * Stands in for a binary asset in the "engine" test project.
 *
 * Metro turns `require('./x.mp3')` into a number at build time; plain Node has no
 * idea what an MP3 module is. Without this, a pure module becomes untestable the
 * moment anything it imports mentions an audio file — which is how the adhan
 * library, which is pure logic, ended up unreachable from the fast test project.
 *
 * The value only has to be a number, because that is all an asset id ever is.
 */
module.exports = 1;
