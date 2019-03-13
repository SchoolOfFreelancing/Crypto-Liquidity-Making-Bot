let request = require('request');
const crypto = require('crypto');
const tools = require('../../tools');
let config;
let Pusher = require('pusher-js');
let order_book = [];

let setGetOrdersListByPusher = function(){
    return new Promise(function (resolve) {
        let pusher_order_book = [];
        let pusherCounter = 0;

        const coinmatePusher = new Pusher('af76597b6b928970fbb0', {
            encrypted: true
        });

        for(let i=0;i<config.pairs.length;i++){
            const pair = config.pairs[i].name;
            pusher_order_book[pair] = coinmatePusher.subscribe('order_book-' + pair);
            pusher_order_book[pair].bind('order_book', function(data) {
                order_book[pair] = data;
                pusherCounter++;
            });
        }
        resolve(true);
    });
};

let setConfig = function(data){
    config = data;
};

let sign = function() {
    let clientId = config.clientId;
    let publicApiKey = config.publicKey;
    let nonce = Date.now().toString();
    let signatureInput =  nonce + clientId + publicApiKey;

    const hmac = crypto.createHmac('sha256', config.privateKey);
    hmac.update(signatureInput);
    let signature = hmac.digest('hex').toUpperCase();
    return "clientId="+clientId+"&publicKey="+publicApiKey+"&nonce="+nonce+"&signature="+signature;
};

let getBalance = function(){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/balances',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: sign()
        }, function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    resolve({s:1, data: result.data});
                } else {
                    console.error("coinmate getBalance");
                    console.error(body);
                    resolve({s:0, data: result});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0, data: {error: "getBalance"}});
            }
        });
    });
};
/* Get actual order book with buys and sells */
let getTicker = async function (pair){
    if(typeof order_book[pair] === 'undefined'){
        console.log(pair + " waiting on order book!");
        await tools.sleep(1000);
        return {s:0, data: null, counter: 0};
    } else {
        return {s:1, data: order_book[pair], counter: 0};
    }
    /*
    return new Promise(function (resolve) {
        request('https://coinmate.io/api/orderBook?currencyPair='+pair+'&groupByPriceLimit=false', function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    resolve({s:1, data: result, counter: 1});
                } else {
                    console.error(body);
                    resolve({s:0, data: result, counter: 1});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0, data: {error: "getTicker"}, counter: 1});
            }
        });
    });
    */
};

let parseTicker = function(type, book, pair, order){
    let ticks = {bid:[],bidBorder: 0, ask:[], askBorder:0};
    let ii=0;
    for(let i=0;i<book.asks.length;i++){
        if(i===0){
            ticks.askBorder = parseFloat(book.asks[i].price);
        }
        if(type === "ask"){
            if(typeof order !== 'undefined' && order.hasOwnProperty('sell_price') && parseFloat(book.asks[i].price) === order.sell_price){
                const askSizeDiff = (parseFloat(book.asks[i].amount)-order.sell_size);
                if( askSizeDiff > pair.ignoreOrderSize){
                    ticks.ask.push({price: parseFloat(book.asks[i].price), size: tools.setPrecision(askSizeDiff, pair.digitsSize)});
                    ii++;
                }
            } else if( parseFloat(book.asks[i].amount) > pair.ignoreOrderSize){
                ticks.ask.push({price: parseFloat(book.asks[i].price), size: parseFloat(book.asks[i].amount)});
                ii++;
            }
        } else {
            break;
        }
    }
    ii=0;
    for(let i=0;i<book.bids.length;i++){
        if(i === 0){
            ticks.bidBorder = parseFloat(book.bids[i].price);
        }
        if(type === "bid"){
            if(typeof order !== 'undefined' && order.hasOwnProperty('buy_price') && parseFloat(book.bids[i].price) === order.buy_price){
                const bidSizeDiff = (parseFloat(book.bids[i].amount)-order.buy_size);
                if( bidSizeDiff > pair.ignoreOrderSize){
                    ticks.bid.push({price: parseFloat(book.bids[i].price), size: tools.setPrecision(bidSizeDiff, pair.digitsSize)});
                    ii++;
                } else {
                    //console.log("My position "+book.bids[i].price+" was alone (Lets process ask fornot counted ignored), removed from ticks.");
                }
            } else if(parseFloat(book.bids[i].amount) > pair.ignoreOrderSize){
                ticks.bid.push({price: parseFloat(book.bids[i].price), size: parseFloat(book.bids[i].amount)});
                ii++;
            }
        } else {
            break;
        }
    }
    return ticks;
};

let getOrder = async function (id, type, openedOrder){
    const rTH = await getTransactionHistory(id);
    if(rTH.s){
        let orderDetail = new tools.orderDetailForm;
        orderDetail.id = id;
        orderDetail.pair = openedOrder.pair;
        orderDetail.type = type;
        switch(type){
            case "BUY":
                orderDetail.price = openedOrder.buy_price;
                orderDetail.size = openedOrder.buy_size;
                orderDetail.funds = openedOrder.buy_price*openedOrder.buy_size;
                break;
            case "SELL":
                orderDetail.price = openedOrder.sell_price;
                orderDetail.size = openedOrder.sell_size;
                orderDetail.funds = openedOrder.sell_size;
                break;
        }
        if(rTH.data.length > 0){
            for(let i=0;i<rTH.data.length;i++){
                orderDetail.size_filled += rTH.data[i].amount;
                orderDetail.fee += rTH.data[i].fee;
            }
            /*
                Convert to 64 bits (8 bytes) (16 decimal digits)
                When sum 0.0001 and 0.0002 we can get this result: 0.00030000000000000003
            */
            orderDetail.size_filled = tools.setPrecision(orderDetail.size_filled, 16);
            orderDetail.fee = tools.setPrecision(orderDetail.fee, 16);
            if(orderDetail.size === orderDetail.size_filled){
                orderDetail.status = "fulfilled";
            } else {
                orderDetail.status = "partially_filled";
            }
        } else {
            orderDetail.status = "canceled";
        }
        return {"s": true, "data": orderDetail};
    } else {
        // getTransactionHistory error, repeat call
        getOrder(id, type, openedOrder);
    }
};

let cancelOrder = function (id, type, openedOrder){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/cancelOrder',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "orderId=" + id + "&" + sign()
        }, async function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    if(result.data){
                        const detailCanceledOrder = await getOrder(id, type, openedOrder);
                        resolve({"s":1, "data": detailCanceledOrder.data});
                    } else {
                        resolve({"s":0, "data": {"error": "not found"}});
                    }
                } else {
                    console.error("coinmate cancelOrder");
                    console.error(body);
                    resolve({s:0, data: {"error": response.statusCode}});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0, data: {error: "getTicker"}});
            }
        });
    });
};

let createOrder = async function (pair, type, pendingSellOrder, price){
    let size = "";
    switch(type){
        case "BUY":
            size = tools.getBuyOrderSize(pair, price);
            if(size > 0){
                return await buyLimitOrder(pair.name, size, price);
            } else {
                return {s:0, errorMessage: "Size order not set in config."};
            }
        case "SELL":
            size = pendingSellOrder.sell_size.toString();
            return await sellLimitOrder(pair.name, size, price);
    }
};
let buyLimitOrder = function (currencyPair, amount, price){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/buyLimit',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "currencyPair=" + currencyPair + "&amount=" + amount + "&price=" +price + "&" + sign()
        }, function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    if(result.error){
                        if(result.errorMessage.includes("Minimum Order Size")){
                            resolve({s:0, errorMessage: "insufficient size"});
                        } else {
                            resolve({s:0, errorMessage: result.errorMessage});
                        }
                    } else {
                        let createdOrder = new tools.orderCreatedForm;
                        createdOrder.id = result.data;
                        createdOrder.price = price;
                        createdOrder.size = amount;
                        createdOrder.funds = amount * price;
                        resolve({s: 1, data: createdOrder});
                    }
                } else {
                    console.error("coinmate buyLimitOrder");
                    console.error(body);
                    resolve({s:0, errorMessage: body});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0, errorMessage: "buyLimitOrder"});
            }
        });
    });
};

let sellLimitOrder = function (currencyPair, amount, price){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/sellLimit',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "currencyPair=" + currencyPair + "&amount=" + amount + "&price=" +price + "&" + sign()
        }, function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    if(result.error){
                        if(result.errorMessage.includes("Minimum Order Size")){
                            resolve({s:0, errorMessage: "insufficient size"});
                        } else {
                            resolve({s:0, errorMessage: result.errorMessage});
                        }
                    } else {
                        let createdOrder = new tools.orderCreatedForm;
                        createdOrder.id = result.data;
                        createdOrder.price = price;
                        createdOrder.size = amount;
                        createdOrder.funds = amount*price;
                        resolve({s:1, data: createdOrder});
                    }
                } else {
                    console.error("coinmate sellLimitOrder");
                    console.error(body);
                    resolve({s:0, errorMessage: body});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0, errorMessage: "sellLimitOrder"});
            }
        });
    });
};


let getTransactionHistory = function (orderId ){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/transactionHistory',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "orderId=" + orderId + "&" + sign()
        }, function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    resolve({s:1, data: result.data});
                } else {
                    console.error("coinmate getTransactionHistory");
                    console.error(body);
                    resolve({s:0, data: result.errorMessage});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0});
            }
        });
    });
};

/* Get my actual open orders waiting on FILLED*/
let getOpenOrders = function (currencyPair){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/openOrders',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "currencyPair=" + currencyPair + "&" + sign()
        }, function (error, response, body) {
            if (error) throw error;
            if(response.statusCode === 200) {
                resolve(JSON.parse(body));
            }
        });
    });
};

let getOrderHistory = function (currencyPair, limit){
    return new Promise(function (resolve) {
        request({
            method: 'POST',
            url: 'https://coinmate.io/api/orderHistory',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: "currencyPair=" + currencyPair + "&limit=" + limit + "&" + sign()
        }, function (error, response, body) {
            try {
                const result = JSON.parse(body);
                if (!error && response.statusCode === 200) {
                    resolve({s:1, data: result});
                } else {
                    console.error("coinmate getOrderHistory");
                    console.error(body);
                    resolve({s:0, data: result});
                }
            } catch (e) {
                console.error(body);
                console.error(e);
                resolve({s:0, data: {error: "getOrderHistory"}});
            }
        });
    });
};

module.exports = {
    setConfig: setConfig,
    setGetOrdersListByPusher: setGetOrdersListByPusher,
    getBalance: getBalance,
    getTicker: getTicker,
    parseTicker: parseTicker,
    getOrder: getOrder,
    cancelOrder: cancelOrder,
    createOrder: createOrder,
};

