// Existing review UI runs as an authenticated fixture, without a production login bypass.
require('../../amap-server.cjs').createServer({acceptanceIdentity:'legacy-content-test'}).listen(8778,'127.0.0.1');
