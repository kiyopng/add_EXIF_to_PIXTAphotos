const fs = require('fs');
const {promisify} = require('util');
const rp = require('request-promise');
const request = require('request');
const cheerio = require('cheerio');
const client = require('cheerio-httpcli');
const del = require('del');
const log4js = require('log4js');
log4js.configure({
    appenders: {
        system: {type: 'file', filename: 'system.log'}
    },
    categories: {
        default: {appenders:['system'], level: 'info'}
    }
});
const log = log4js.getLogger();

const share_path = process.argv[2];
const share_dir = process.argv[3];
const share_done = process.argv[4];
const local_dir = 'tmp/';

const chokidar = require('chokidar');
const watcher = chokidar.watch(share_path + share_dir,{
	ignored:/[\/\\]\./,
	depth:0,
	persistent:true,
	awaitWriteFinish:true
});

const options = {
  transform: (body) => {
    return cheerio.load(body);
  }
};

//watcher.on('ready',async function(){
	console.log('watching...');
	log.info('watching...');
	
	watcher.on('add',async function(path){
		let filename = path.substr(path.lastIndexOf('\\')+1).toString();
		if(filename.toLowerCase().match(/.(jpg|jpeg|png|gif|ai|psd|eps)$/i)){
			
			//ファイル名退避
			let name_bk = filename;
			
			//日本語チェック
			let chk = chk_ja(filename);
			let ja = chk ? chk[0] : '';
			let copyname = chk ? filename.replace(new RegExp(ja, 'g'),'') : filename;
			
			copyname = copyname.match(/[0-9]{1,}/)[0] + '.' + copyname.split('.')[1];
			
			//所有者取得
			let author = await get_author(share_path + share_dir + filename);
			console.log(author);
			
			//ローカルへファイルコピー
			await fs.copyFileSync(share_path + share_dir + filename,local_dir + copyname);
			await fs.unlinkSync(share_path + share_dir + filename);
			
			//タグ情報取得
			let url = 'https://pixta.jp/photo/' + copyname.match(/[0-9]{1,}/)[0];
			let tags = await get_tags_chrome(url);
			
			////EXIF追加
			await exif(local_dir + copyname,tags);
			
			//共有へファイルアップ
			await fs.copyFileSync(local_dir + copyname , share_path + share_dir + share_done + name_bk);
			deletefile(local_dir + copyname);
			
		}
	});
	
	watcher.on('unlink',function(path){
		let filename = path.substr(path.lastIndexOf('\\')+1).toString();
		console.log('削除されました:' + filename);
		log.info('削除されました:' + filename);
	})
	
//});

function exif(filepath,tags){
	const exiftool = require('node-exiftool');
	const ep = new exiftool.ExiftoolProcess();
	return new Promise(resolve => {
		ep.open()
		.then(() => ep.writeMetadata(filepath, {
		'Keywords': tags,
		'Subject': tags,
		}, ['overwrite_original','codedcharacterset=utf8']))
		.then(() => ep.close())
		.then(() => {
			resolve();
			console.log('タグが付与されました:' + filepath);
			log.info('タグが付与されました:' + filepath);
		});
	});
}

/*
  素のcheerioだと403が返ってくるようになったのでcheerio-httpcliへ変更　多分User-agent
*/
function get_tags(urls){
	return new Promise(resolve => {
		rp.get(urls, options)
		.then(($) => {
			let result = $('.product-tags__content > a').text();
			result = result.replace(/\s+/g, ",");
			result = result.slice(1).slice(0,-1);
			result = result.split(',');
			return resolve(result);
		}).catch((error) => {
			return resolve('');
			log.info('Error:', error);
		});
	});
}

function get_tags_chrome(url){
	return new Promise(resolve => {
		//client.setBrowser('chrome');
		client.fetch(url)
		.then((result) => {
			let tags = result.$('.product-tags__content > a').text();
			tags = tags.replace(/\s+/g, ",");
			tags = tags.slice(1).slice(0,-1);
			tags = tags.split(',');
			return resolve(tags);
		})
		.catch((err) =>{
			return resolve('');
			log.info('Error:', err);
		})
	});
}

function get_author(filepath){
	const exiftool = require('node-exiftool');
	const ep = new exiftool.ExiftoolProcess();
	return new Promise(resolve => {
		ep.open()
		.then(()=> ep.readMetadata(filepath,['Author','Creator']))
		.then((result)=>{
			ep.close();
			resolve(result);
		})
		.catch(console.error);
	});
}

//日本語チェック
function chk_ja(str){
	chk = str.match(/[^\x00-\x7E]+/g);
	return chk;
}

//元ファイルを削除
function deletefile(filename){
	return del(filename);
}