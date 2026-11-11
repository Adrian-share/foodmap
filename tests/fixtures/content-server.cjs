const {createServer}=require('../../beijing-food-map/amap-server.cjs');
const {fixture}=require('./content.cjs');
createServer({contentState:fixture().state,mode:'fixture',dataset:'verified',jsKey:'test-map-key',securityCode:'test-map-security'}).listen(18909,'127.0.0.1');
