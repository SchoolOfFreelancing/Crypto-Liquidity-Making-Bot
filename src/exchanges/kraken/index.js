let cp = require('child_process');
let krakenWorker = cp.fork('src/exchanges/kraken/worker.js');
let ws = require('./../../websocket');

let config;

let start = function(configuration){
    config = configuration;
    krakenWorker.send({"type": "init", "config": config});
};

let stop = function(){
    return new Promise(function (resolve) {
        krakenWorker.send({"type": "stop"});
        setTimeout(function(){
            //If worker cannot be stopped, mark him for skip
            resolve(false);
        }, 25000);

        krakenWorker.on('exit', (code, signal) => {
            //console.log('Exit', code, signal);
            resolve(true);
        });
    });
};

krakenWorker.on('message', async function (data) {
    switch (data.type) {
        case "init":
            if(data.success){
            }
            break;
        case "stopped":
            console.log("krakenWorker stopped");
            krakenWorker.kill();
            break;
        case "ticker":
            ws.emitPendingOrders(data);
            break;
        case "completedOrder":
            ws.emitCompletedOrder(data);
            break;
        case "filledBuyOrder":
            ws.emitFilledBuyOrder(data);
            break;
    }
});

module.exports = {
    start: start,
    stop: stop
};