import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import bodyParser from "body-parser";
import expressPinoLogger from "express-pino-logger";
import { logger } from './utils/logger.js';
import cors from 'cors';
import mysql from 'mysql';
import dotenv from 'dotenv';

dotenv.config()
const isHttps = process.env.isHttps * 1 === 1;
const httpsPort = process.env.httpsPort;
const httpPort = process.env.httpPort;

const tableName = process.env.TABLE_NAME;
const nftTableName = process.env.NFT_TABLE_NAME;
const apiBaseUrl = process.env.API_BASE_PATH;

let credentials = null;
if(isHttps) {
  const privateKey  = fs.readFileSync('sslcert/server.key', 'utf8');
  const certificate = fs.readFileSync('sslcert/server.pem', 'utf8');
  credentials = {key: privateKey, cert: certificate};
}

const app = express();
app.use(bodyParser.json());
app.use(expressPinoLogger({ logger: logger }));
setCors(app);

const connection = mysql.createConnection({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
});

app.get(apiBaseUrl + '/test', function (req, res) {
   res.send('Hello World!');
})

function setCors(app) {
  const whitelist = [
    'http://127.0.0.1:3000', 
    'http://localhost:3000', 
		'https://nusic.vip',
		"https://box.nusic.vip",
    'https://www.nusic.vip',
		'https://mysterybox-web.vercel.app'
  ];
  const origin = function (origin, callback) {
    if(origin === undefined) callback(null, true); // for postman testing ######
    else if (whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      console.log('Not allowed by CORS');
      // callback(new Error('Not allowed by CORS'))
    }
  };
  console.log('cors origin', origin);
  app.use(cors({
      origin,
      maxAge: 5,
      credentials: true,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposeHeaders: ['WWW-Authenticate', 'Server-Authorization'],
    })
  )
}

/**
 * Get top 10 referers today.
 * @param limit top n list, default is 10
 */
app.post(apiBaseUrl + '/getTopReferers', function (req, res) {
	const limit = req.body.limit !== undefined ? parseInt(req.body.limit) : 10;
	const startTimestamp = getUTCStartTimestamp();
	const endTimestamp = parseInt(((new Date()).getTime()) / 1000)
	const team = req.body.team === undefined ? 0 : parseInt(req.body.team);
	// const sql = `select referer, count(*) as nums from ${tableName} 
	// 						 where createAt >= ${startTimestamp} and createAt <= ${endTimestamp} 
	// 						 and team = ${team} group by referer order by nums desc limit ${limit}`;
	const sql = `select referer, sum(amount * rate / 10000 / 100000000000000000000) as sums from ${tableName} 
							 where createAt >= ${startTimestamp} and createAt <= ${endTimestamp} 
							 and team = ${team} group by referer order by sums desc limit ${limit}`;

	try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length == 0) res.send({success: false, message: 'no data'})
        else {
          let list = [];
          for(let i = 0; i < data.length; i++) {
            list.push({
							referer: data[i].referer,
							count: data[i].sums,
            }) 
          }
          res.send({
            success: true,
            data: {
							list,
							startTimestamp,
							endTimestamp
						}
          })
        }
      }
    })  
  } catch (err) {
    res.send({success: false, message: err.message});
  }
})

/**
 * Get top 10 referers by date
 * @param limit top n list, default is 10
 * @param timestamp timestamp of anytime of some date, return back the top list by the UTC timestamp of start and end of that day
 * Note: timestamp must be unxitimestamp, 10 digitals
*/
app.post(apiBaseUrl + '/getTopReferersByDate', function(req, res) {
	const limit = req.body.limit !== undefined ? parseInt(req.body.limit) : 10;
	const startTimestamp = getUTCStartTimestampOf(req.body.timestamp)
	const endTimestamp = startTimestamp + 24 * 3600;
	const team = req.body.team === undefined ? 0 : parseInt(req.body.team);
	// console.log(startTimestamp, endTimestamp);

	const sql = `select referer, count(amount * rate / 10000 / 100000000000000000000) as sums from ${tableName} 
							 where createAt >= ${startTimestamp} and createAt <= ${endTimestamp} 
							 and team = ${team} group by referer order by sums desc limit ${limit}`;
	console.log(sql);
	try {
    connection.query(sql, function(error, data, fields) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length == 0) res.send({success: false, message: 'no data'})
        else {
          let list = [];
          for(let i = 0; i < data.length; i++) {
            list.push({
							referer: data[i].referer,
							count: data[i].sums,
            }) 
          }
          res.send({
            success: true,
            data: {
							list,
							startTimestamp,
							endTimestamp
						}
          })
        }
      }
    })  
  } catch (err) {
    res.send({success: false, message: err.message});
  }
})


/**
 * Get the referee number of given address
 * Max level is 5
 */
app.post(apiBaseUrl + '/getAllReferee', async function (req, res) {
	if(req.body.address === undefined) {
		res.send({success: false, message: "Unavailable address"});
		return;
	}
	const levels = req.body.levels === undefined || parseInt(req.body.levels) > 50 ? 50 : req.body.levels;
	const address = req.body.address;
	const team = req.body.team === undefined ? 0 : parseInt(req.body.team);

	let allList = [];
	let newList = [];
	allList.push({address: `\'${address}\'`, amount: 0, rate: 0, number: 0});
	newList.push({address: `\'${address}\'`, amount: 0, rate: 0, number: 0});

	let fundedNewList = [];
	let fundedAllList = [];
	fundedAllList.push({address: `\'${address}\'`, amount: 0, rate: 0, number: 0});
	fundedNewList.push({address: `\'${address}\'`, amount: 0, rate: 0, number: 0});

	for(let i = 0; i < levels; i++) {
		const addressList = getAddressList(allList);
		let sql = `select * from ${tableName} 
							 where referer in (${addressList}) and team=${team}`;
		const refs = await getReferee(sql);
		newList = refs.referers;
		fundedNewList = refs.funded;
		
		if(newList === undefined || newList.length === 0) break;
		
		newList = removeItemsFromArray(newList, allList);
		allList.push(...newList);
		fundedNewList = removeItemsFromArray(fundedNewList, fundedAllList);
		fundedAllList.push(...fundedNewList);
	}

	res.send({success: true, data: {
		list: allList,
		count: allList.length,
		fundedList: fundedAllList,
		fundedCount: fundedAllList.length,
	}});
})

const getAddressList = (arr) => {
	let addresses = [];
	for(let i = 0; i < arr.length; i++) addresses.push(arr[i].address);
	return addresses.join(', ');
}

const getReferee = (sql) => {
	return new Promise((resolve, reject) => {
		try {
			connection.query(sql, function (err, result) {
				if(err) return reject(err);
				else if(result.length === 0) resolve([]);
				else {
					let referers = [];
					let funded = [];
					
					for(let i = 0; i < result.length; i++) {
						referers.push({
							address: `\'${result[i].referee}\'`,
							amount: result[i].amount,
							rate: result[i].rate,
							number: result[i].amount * result[i].rate / 1e24,
						});
						if(parseInt(result[i].funded) === 1) {
							funded.push({
								address: `\'${result[i].referee}\'`,
								amount: result[i].amount,
								rate: result[i].rate,
								number: result[i].amount * result[i].rate / 1e24,
							});
						}
					}
					resolve({referers, funded});
				}
			})
		} catch(err) {
			reject(err);
		}
	})
} 

/**
 * Get direct referee
 */
app.post(apiBaseUrl + '/getDirectReferee', function (req, res) {
	if(req.body.address === undefined) {
		res.send({success: false, message: "Unavailable address"});
		return;
	}
	const address = req.body.address;
	const team = req.body.team === undefined ? 0 : parseInt(req.body.team);
	let sql = `select * from ${tableName} where referer = '${address}' and team = ${team}`;
	try {
		connection.query(sql, function (error, data) {
      if(error) res.send({success: false, message: error.message});
      else {
        if(data.length == 0) res.send({success: false, message: 'no data'})
        else {
          let list = [];
          for(let i = 0; i < data.length; i++) {
            list.push({
							referer: data[i].referer,
							referee: data[i].referee,
							funded: data[i].funded,
							rate: data[i].rate,
							amount: data[i].amount,
							number: data[i].amount * data[i].rate / 1e24,
							team: data[i].team,
            }) 
          }
          res.send({
            success: true,
            data: {
							list,
						}
          })
        }
      }
		})
	} catch (error) {
		console.log(error);
	}
})

/**
 * Get NFTs by owner
 */
app.post(apiBaseUrl + '/getNFTsForOwner', function (req, res) {
	if(req.body.address === undefined) {
		res.send({success: false, message: "Unavailable address"});
		return;
	}
	const chainId = req.body.chainId;
	const address = req.body.address;
	const nftAddress = req.body.nftAddress;
	let sql = `select * from ${nftTableName} where chainId = ${chainId} and lower(owner) = '${address.toLowerCase()}' and lower(nftAddress) = '${nftAddress.toLowerCase()}'`;
	try {
		connection.query(sql, function (error, data) {
			if(error) res.send({ success: false, message: 'no data' })
			else {
				let list = [];
				for (let i = 0; i < data.length; i++) {
					list.push({
						chainId: data[i].chainId,
						nftAddress: data[i].nftAddress,
						tokenId: data[i].tokenId
					})
				}
				res.send({
					success: true,
					data: {
						list,
					}
				})
			}
		})
	} catch(error) {
		console.log(error);
	}
})

const removeItemFromArray = (array, item) => {
	for(let i = 0; i < array.length; i++) {
		if(array[i].address === item.address) {
			array.splice(i, 1);
			break;
		}
	}
	return array;
}

const removeItemsFromArray = (array, items) => {
	// let array_ = array;
	for(let i = 0; i < items.length; i++) {
		array = removeItemFromArray(array, items[i]);
	}
	return array;
}

function getUTCStartTimestamp() {
	const startOfDay = new Date();
	startOfDay.setUTCHours(0, 0, 0, 0);
	return parseInt((new Date(startOfDay).getTime()) / 1000);
}

function getUTCStartTimestampOf(timestamp) {
	const startOfDay = new Date(timestamp * 1000);
	startOfDay.setUTCHours(0, 0, 0, 0);
	return parseInt((new Date(startOfDay).getTime()) / 1000);
}

app.use('/images', express.static('images'));

app.get(apiBaseUrl + '/metadata/:tokenId', function (req, res) {
	res.send({
		name: "SNFT",
		description: "SNFT for NUSIC mysterybox",
		image: process.env.BASE_URL + "/images/" + (req.params.tokenId % 5 + 1) + ".jpg",
	})
});

if(isHttps) {
  const httpsServer = https.createServer(credentials, app);
  httpsServer.listen(httpsPort, function () {
    logger.info(`Nusic api has started on https port ${httpsPort}.`);
  })  
}

const httpServer = http.createServer(app);
httpServer.listen(httpPort, function () {
  logger.info(`Nusic api has started on http port ${httpPort}.`);
})
