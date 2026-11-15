// Loopback acceptance only. Production Node adapters ignore all inbound identity headers.
const {createServer}=require('../../beijing-food-map/amap-server.cjs');
createServer({acceptanceIdentity:'local-acceptance-user'}).listen(18913,'127.0.0.1');
createServer().listen(18914,'127.0.0.1');
