var request = require( 'request' );
var cheerio = require( 'cheerio' );
var fs = require( 'fs' );
var mysql = require( 'mysql' );
var express = require( 'express' );
var router = express.Router();
// required middleware for express 4.1
var logger = require ('morgan');
var compress = require ('compression');

var app = express();
app.enable( "jsonp callback" );
var http = require( 'http' );
var url = require( 'url' );
var server = http.createServer( app );
var zlib = require( 'zlib' );
var Q = require( 'q' );
var race = require('./racecache.js');
var allow_update = false;

// read cfg.json
var data = fs.readFileSync( __dirname + '/cfg.json' );
var cfg;
try {
	cfg = JSON.parse( data );
	console.log( 'info', 'Parsed cfg' );
}
catch( err ) {
	console.log( 'warn', 'failed to parse cfg: ' + err );
}

//multipleStatements: true,
cfg.mysql_db.multipleStatements = true;
cfg.mysql_db.waitForConnections = false;
cfg.mysql_db.connectionLimit = 15;
var dbpool = mysql.createPool( cfg.mysql_db );
//var db = mysql.createConnection( cfg.mysql_db );
//db.connect();
// db timeout

/*
setInterval( function() {
	db.ping();
}, 10*60*1000 );
*/

// counter
var requests_counter = 0;
var requests_counter_api = 0;
var requests_counter_pub = 0;
var requests_counter_total = 0;
if( cfg.counter.on ) {
	/*
	setInterval( function() {
		// write counter to file for use in external app
		fs.writeFile( cfg.counter.path, requests_counter, function ( err ) {
			if( err ) { throw err; }
			requests_counter = 0;
		} );
	}, 5*1000 );
	*/
}

// cache
// read cfg.json
var CACHE = {};
try {
	//fs.writeFile( cfg.api.games.tempdir + j.PUBLIC_ID + '.json', body, function( err ) {
	var cachefile = cfg.api.cachefile || __dirname + '/cache.json';
  var _data = fs.readFileSync( cachefile );
  CACHE = JSON.parse(_data);
	console.log( 'info', 'Parsed Cache file' );
}
catch( err ) {
	console.log( 'warn', 'failed to parse Cache file: ' + err );
}

var maxAge_public, maxAge_api, http_cache_time;
//updated for express 4.1.x
var env = process.env.NODE_ENV || 'development';
if ('development' == env) {
    maxAge_public = 0;
    maxAge_api = 60*1000;
    maxAge_api_long = 60*60*100;
// should not use cache in dev    http_cache_time = 60*60;
}

var env = process.env.NODE_ENV || 'production';
if ('production' == env) {
    allow_update = true;
    maxAge_public = 24*60*60*1000;
    maxAge_api = 60*1000;
    maxAge_api_long = 60*60*1000;
    http_cache_time = 60*60;
}


// gzip/compress
app.use( compress() );
// http console logger changed to dev, so no stack trace whilst non dev env
app.use( logger( 'dev' ) );
// http log to file
var logFile = fs.createWriteStream( cfg.api.httplogfile, { flags: 'w' } );
app.use( logger( { stream: logFile } ) );
// count requests made
app.use( function( req, res, next ) {
	++requests_counter;
	++requests_counter_pub;
	++requests_counter_total;
	next();
} );
// serve static html files
app.use( express.static( __dirname + '/public', { maxAge: maxAge_public } ) );
// serve saved games from /get/game/<PUBLIC_ID>.json.gz
app.use( '/get/game', express.static( __dirname + '/games' ) );
app.use( function( req, res, next ) {
	//--requests_counter;
	--requests_counter_pub;
	++requests_counter_api;
	next();
} );

var _perpage = 20;
var lastgames = [];

// api
app.get( '/api', function ( req, res ) {
	// express3 res.jsonp( { data: { routes: app.routes } } );
        res.jsonp( { data: { routes: express.router.stack } } );
	res.end();
} );
app.get( '/api/search/players/:search_str', function ( req, res ) {
	var sql = 'select NAME from Player WHERE NAME like ? ORDER BY 1 LIMIT 200';
	dbpool.getConnection( function( err, conn ) {
		if( err ) throw err;
		conn.query( sql, [ req.params.search_str + "%" ], function( err, rows ) {
			conn.release();
			if( err ) throw err;
			res.jsonp( { data: { players: rows } } );
			res.end();
		} );
	} );
} );
app.get( '/api/search/players_with_details/:search_str', function ( req, res ) {
	var sql = 'SELECT p.NAME as PLAYER_NICK, c.NAME as PLAYER_CLAN, p.COUNTRY as PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, '
    + 'sum(case when gp.TEAM = g.WINNING_TEAM then 1 else 0 end) as MATCHES_WON, '
    + 'sum(case when gp.TEAM = g.WINNING_TEAM then 1 else 0 end)/count(1)*100 as WIN_PERCENT, '
    + 'sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, '
    + 'sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, '
    + 'sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, '
    + 'sum(KILLS) as KILLS, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(gp.KILLS)/sum(gp.DEATHS) as RATIO, '
    + 'sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, '
    + 'avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, '
    + 'sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, '
    + 'sum(PLAY_TIME) as PLAY_TIME, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, '
    + 'sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, '
    + 'sum(BFG_H) as BFG_H_SUM, avg(BFG_H) as BFG_H_AVG, sum(BFG_K) as BFG_K_SUM, avg(BFG_K) as BFG_K_AVG, sum(BFG_S) as BFG_S_SUM, avg(BFG_S) as BFG_S_AVG, '
    + 'sum(CG_H) as CG_H_SUM, avg(CG_H) as CG_H_AVG, sum(CG_K) as CG_K_SUM, avg(CG_K) as CG_K_AVG, sum(CG_S) as CG_S_SUM, avg(CG_S) as CG_S_AVG, '
    + 'sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, '
    + 'sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, '
    + 'sum(NG_H) as NG_H_SUM, avg(NG_H) as NG_H_AVG, sum(NG_K) as NG_K_SUM, avg(NG_K) as NG_K_AVG, sum(NG_S) as NG_S_SUM, avg(NG_S) as NG_S_AVG, '
    + 'sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, '
    + 'sum(PM_H) as PM_H_SUM, avg(PM_H) as PM_H_AVG, sum(PM_K) as PM_K_SUM, avg(PM_K) as PM_K_AVG, sum(PM_S) as PM_S_SUM, avg(PM_S) as PM_S_AVG, '
    + 'sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, '
    + 'sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, '
    + 'sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG '
    + 'FROM Player p left join CLAN c on c.ID=p.CLAN_ID left join GamePlayer gp on gp.PLAYER_ID=p.ID left join Game g on g.ID=gp.GAME_ID '
    + 'WHERE p.NAME like ? GROUP BY PLAYER_NICK order by 1 LIMIT 200';
	dbpool.getConnection( function( err, conn ) {
		if( err ) { console.log( err ); }
		conn.query( sql, [ req.params.search_str + "%" ], function( err, rows ) {
			conn.release();
			if( err ) { console.log( err ); }
			res.jsonp( { data: { players: rows } } );
			res.end();
		} );
	} );
} );
app.get( '/api/search/teams', function ( req, res ) {
	var queryObject = url.parse( req.url, true ).query;
	var _nicks = _owners = _players = _gametypes = _maps = _ranked = _premium = _ruleset = _tags = null;
	var _nicks_sql = _owners_sql = _owners_sql2 = _players_sql = _gametypes_sql = _maps_sql = _ranked_sql = _premium_sql = _tags_sql = _tags_sql2 = _ruleset_sql = "";
	if( typeof queryObject.nicks != 'undefined' ) { _nicks = mysql_real_escape_string( queryObject.nicks ).split( ' ' ); }
	if( typeof queryObject.owners != 'undefined' ) { _owners = mysql_real_escape_string( queryObject.owners ).split( ' ' ); }
	if( typeof queryObject.gametypes != 'undefined' ) { _gametypes = mysql_real_escape_string( queryObject.gametypes ).split( ' ' ); }
	if( typeof queryObject.maps != 'undefined' ) { _maps = mysql_real_escape_string( queryObject.maps ).split( ' ' ); }
	if( typeof queryObject.ranked != 'undefined' ) { _ranked = mysql_real_escape_string( queryObject.ranked ).split( ' ' ); }
	if( typeof queryObject.premium != 'undefined' ) { _premium = mysql_real_escape_string( queryObject.premium ).split( ' ' ); }
	if( typeof queryObject.ruleset != 'undefined' ) { _ruleset = mysql_real_escape_string( queryObject.ruleset ).split( ' ' ); }
	if( typeof queryObject.tags != 'undefined' ) { _tags = mysql_real_escape_string( queryObject.tags ).split( ' ' ); }
	if( _nicks !== null ) {
		_nicks_sql = '(';
		for( var i=0; i<_nicks.length; i++ ) {
			_nicks_sql += ' PLAYER_NICK="' + _nicks[i] + '" ';
			if( ( i + 1 ) != _nicks.length ) { _nicks_sql += ' or '; }
		}
		_nicks_sql += ')';
	}
	if( _owners !== null ) {
		_owners_sql = ' and (';
		for( var i=0; i<_owners.length; i++ ) {
			_owners_sql += ' OWNER="' + _owners[i] + '" ';
			if( ( i + 1 ) != _owners.length ) { _owners_sql += ' or '; }
		}
		_owners_sql += ')';
		_owners_sql2 = ' left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID ';
	}
	if( _gametypes !== null ) {
		_gametypes_sql = ' and (';
		for( var i=0; i<_gametypes.length; i++ ) {
			_gametypes_sql += ' GAME_TYPE="' + _gametypes[i] + '" ';
			if( ( i + 1 ) != _gametypes.length ) { _gametypes_sql += ' or '; }
		}
		_gametypes_sql += ')';
		_owners_sql2 = ' left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID ';
	}
	if( _maps !== null ) {
		_maps_sql = ' and (';
		for( var i=0; i<_maps.length; i++ ) {
			_maps_sql += ' MAP="' + _maps[i] + '" ';
			if( ( i + 1 ) != _maps.length ) { _maps_sql += ' or '; }
		}
		_maps_sql += ')';
		_owners_sql2 = ' left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID ';
	}
	if( _tags !== null ) {
		_tags_sql = ' and (';
		for( var i=0; i<_tags.length; i++ ) {
			_tags_sql += ' tag_id=' + _tags[i] + ' ';
			if( ( i + 1 ) != _tags.length ) { _tags_sql += ' or '; }
		}
		_tags_sql += ')';
		_tags_sql2 = ' left join game_tags on Players.PUBLIC_ID=game_tags.PUBLIC_ID ';
	}
	if( _ranked !== null ) {
		_ranked_sql = ' and (';
		for( var i=0; i<_ranked.length; i++ ) {
			_ranked_sql += ' RANKED="' + _ranked[i] + '" ';
			if( ( i + 1 ) != _ranked.length ) { _ranked_sql += ' or '; }
		}
		_ranked_sql += ')';
		_owners_sql2 = ' left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID ';
	}
	if( _premium !== null ) {
		_premium_sql = ' and (';
		for( var i=0; i<_premium.length; i++ ) {
			_premium_sql += ' PREMIUM="' + _premium[i] + '" ';
			if( ( i + 1 ) != _premium.length ) { _premium_sql += ' or '; }
		}
		_premium_sql += ')';
		_owners_sql2 = ' left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID ';
	}
	if( _ruleset !== null ) {
		_ruleset_sql = ' and (';
		for( var i=0; i<_ruleset.length; i++ ) {
			_ruleset_sql += ' RULESET=' + _ruleset[i] + ' ';
			if( ( i + 1 ) != _ruleset.length ) { _ruleset_sql += ' or '; }
		}
		_ruleset_sql += ')';
	}
	var sql = 'select \
	PLAYER_NICK, \
	count(*) as MATCHES_PLAYED, \
	sum(PLAY_TIME) as PLAY_TIME_SUM, \
	avg(RANK) as RANK_AVG, \
	avg(TEAM_RANK) as TEAM_RANK_AVG, \
	avg(SCORE) as SCORE_AVG, \
	avg(KILLS) as KILLS_AVG, \
	avg(DEATHS) as DEATHS_AVG, \
	avg(KILLS/DEATHS) as RATIO_AVG, \
	avg(HITS)/avg(SHOTS)*100 as ACC, \
	avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, \
	avg(SCORE)/avg(PLAY_TIME)*60 as SCORE_PER_MIN_AVG, \
	avg(DAMAGE_DEALT)-avg(DAMAGE_TAKEN) as DAMAGE_NET_AVG  \
	from Players '+ _owners_sql2 +' '+ _tags_sql2 +' WHERE '+ _nicks_sql +' '+ _owners_sql +' '+ _gametypes_sql +' '+ _maps_sql +' '+ _tags_sql +' '+ _ranked_sql +' '+ _premium_sql +' '+ _ruleset_sql +' GROUP BY PLAYER_NICK ORDER BY NULL desc LIMIT 200';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			if( typeof queryObject.dbug != 'undefined' ) {
				res.jsonp( { data: { nicks: _nicks, owners: _owners, gametypes: _gametypes, maps: _maps, ranked: _ranked, premium: _premium, tags: _tags, players: rows }, sql: sql, fields: fields, err: err } );
			}
			else {
				res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
				res.jsonp( { data: { players: rows } } );
			}
			res.end();
			conn.release();
		} );
	} );
} );
app.get('/api/players', function (req, res) {
  var queryObject = url.parse(req.url, true).query;
  var page = parseInt(queryObject.page);
	var sql = 'select NAME as PLAYER_NICK, COUNTRY as PLAYER_COUNTRY from Player LIMIT ' + page*_perpage + ',' + _perpage;
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { players: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get('/api/players/:player', function (req, res) {
  var nick = mysql_real_escape_string(req.params.player);
  var sql = 'SELECT PLAYER_NICK, PLAYER_CLAN, PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end) as MATCHES_WON, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end)/count(*)*100 as WIN_PERCENT, sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, sum(KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG FROM Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID WHERE PLAYER_NICK=\'' + nick + '\' GROUP BY PLAYER_NICK order by NULL';
  dbpool.getConnection(function (err, conn) {
    conn.query(sql, function (err, rows) {
      res.set('Cache-Control', 'public, max-age=' + http_cache_time);
      res.jsonp({ data: { player: rows[0] } });
      res.end();
      conn.release();
    });
  });
});
app.get('/api/players/:player/games', function (req, res) {
	var sql = 'select PUBLIC_ID, GAME_TIMESTAMP, m.NAME as MAP, GAME_TYPE, o.NAME as OWNER, RULESET, RANKED, PREMIUM, DAMAGE_DEALT/PLAY_TIME as DAMAGE_DEALT_PER_SEC_AVG, p.NAME as PLAYER_NICK, c.NAME as PLAYER_CLAN'
  + ' from GamePlayer gp inner join Player p on p.ID=gp.PLAYER_ID inner join Game g on g.ID=gp.GAME_ID inner join Map m on m.ID=g.MAP_ID left join Clan c on c.ID=gp.CLAN_ID left join Player o on o.ID=g.OWNER_ID '
  + ' where p.NAME=? order by GAME_TIMESTAMP desc';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, [req.params.player], function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { games: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/players/:player/clans', function ( req, res ) {
	var sql = 'select p.NAME as PLAYER_NICK, c.NAME as PLAYER_CLAN, count(*) as MATCHES_PLAYED from Player p inner join GamePlayer gp on gp.PLAYER_ID=p.ID inner join Clan c on c.ID=gp.CLAN_ID '
	  + ' where p.NAME=? group by p.NAME, c.NAME';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, [ req.params.player ], function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { clans: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/players/:player/update', function ( req, res ) {
  if (!allow_update) {
    res.jsonp({ data: {}, error: [{ not_allowed: "" }] });
    res.end();
    return;
  }

  var nick = mysql_real_escape_string(req.params.player);
	var d = new Date();
	var url = 'http://www.quakelive.com/profile/matches_by_week/' + nick + '/' + d.getFullYear() + '-' + ( d.getMonth() + 1 ) + '-' + d.getUTCDate();

  request( url, function( err, resp, body ) {
		if( err ) { throw err; }
		$ = cheerio.load( body );

		var loader = require('./ldcore.js');
		var conn;
		var updatedGames = [];
		var scanned = 0;
    Q.ninvoke(dbpool, "getConnection")
			.then(function(c) { conn = c; })
			.then(function() { return loader.init(conn, { useCache: false })
			.then(function() {
        var tasks = [];
        $('.areaMapC').each(function () {
          ++scanned;
          var publicId = $(this).attr('id').split('_')[1];
          tasks.push(
            loader.query('SELECT PUBLIC_ID FROM Game WHERE PUBLIC_ID=?', [publicId])
            .then(function(result) {
              if (result.length == 0) {
                updatedGames.push(publicId);
                return get_game(loader, publicId);
              } else {
                return undefined;
              }
            })
          );
        });
        return Q.allSettled(tasks);
      })
      .then(function() {
        res.jsonp({ data: { player: nick, updated: updatedGames.length, scanned: scanned, updated_games: updatedGames } });
        res.end();
        })
      .fail(function (err) {
        res.jsonp({ data: { }, error: err });
        res.end();
      })
			.finally(function () {
			  conn.release();			    
      });
		} );
	} );
} );
app.get( '/api/games', function ( req, res ) {
  var sql = 'SELECT g.*, m.NAME as MAP, o.NAME as OWNER, fs.NAME FIRST_SCORER, ls.NAME as LAST_SCORER, dd.NAME as DAMAGE_DELIVERED_NICK, dt.NAME as DAMAGE_TAKEN_NICK, '
  + 'ld.NAME as LEAST_DEATHS_NICK, md.NAME as MOST_DEATHS_NICK, ma.NAME as MOST_ACCURATE_NICK '
  + 'FROM Game g inner join MAP m on m.ID=g.MAP_ID '
  + 'left outer join Player o on o.ID=g.OWNER_ID '
  + 'left outer join Player fs on fs.ID=g.FIRST_SCORER_ID '
  + 'left outer join Player ls on ls.ID=g.LAST_SCORER_ID '
  + 'left outer join Player dd on dd.ID=g.DMG_DELIVERED_ID '
  + 'left outer join Player dt on dt.ID=g.DMG_TAKEN_ID '
  + 'left outer join Player ld on ld.ID=g.LEAST_DEATHS_ID '
  + 'left outer join Player md on md.ID=g.MOST_DEATHS_ID '
  + 'left outer join Player ma on ma.ID=g.MOST_ACCURATE_ID '
  + 'order by g.GAME_TIMESTAMP desc LIMIT 5000';
	if( req.route.path in CACHE ) {
		res.jsonp( { data: { games: CACHE[req.route.path].data } } );
		res.end();
		if( CACHE[req.route.path].ts < new Date().getTime() &&
			!CACHE[req.route.path].fetching ) {
			CACHE[req.route.path].fetching = true;
			dbpool.getConnection( function( err, conn ) {
				if( err ) { console.log( err ); }
				conn.query( sql, function( err, rows ) {
					conn.release();
					if( err ) { console.log( err ); }
					CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
					fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
						if( err ) { console.log( err ); }
					} );
				} );
			} );
		}
	}
	else {
		dbpool.getConnection( function( err, conn ) {
			if( err ) { console.log( err ); }
			conn.query( sql, function( err, rows ) {
				conn.release();
				if( err ) { console.log( err ); }
				CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
				fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
					if( err ) { console.log( err ); }
				} );
				res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
				res.jsonp( { data: { games: rows } } );
				res.end();
			} );
		} );
	}
} );
app.get('/api/games/:game', function (req, res) {
  var game = mysql_real_escape_string(req.params.game);
  var sql = [];
  sql[0] = 'SELECT g.*, m.NAME as MAP FROM Game g inner join Map m on m.ID=g.MAP_ID WHERE g.PUBLIC_ID=\'' + game + '\'';
  sql[1] = 'SELECT p.NAME as PLAYER_NICK, c.NAME as PLAYER_CLAN, gp.* FROM Player p inner join GamePlayer gp on gp.PLAYER_ID=p.ID left outer join Clan c on c.ID=p.CLAN_ID WHERE gp.GAME_ID=(select ID from Game where PUBLIC_ID=\'' + game + '\') order by TEAM';
  sql[2] = 'select gp.TEAM, count(1) as PLAYERS, sum(gp.SCORE) as SCORE_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, '
  + ' avg(gp.SCORE) as SCORE_AVG, sum(gp.KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, avg(gp.DEATHS) as DEATHS_AVG, sum(gp.DEATHS) as DEATHS_SUM, '
  + 'sum(gp.SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(gp.HITS) as HITS_SUM, avg(HITS) as HITS_AVG, avg(gp.DAMAGE_DEALT) as DAMAGE_DEALT_AVG, '
  + 'sum(gp.DAMAGE_DEALT) as DAMAGE_DEALT_SUM, sum(gp.DAMAGE_DEALT)/sum(gp.PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(gp.DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, '
  + 'sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(HUMILIATION) as HUMILIATION_SUM, '
  + 'avg(HUMILIATION) as HUMILIATION_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, avg(RL_H) as RL_H_AVG, sum(RL_H) as RL_H_SUM, avg(RL_S) as RL_S_AVG, sum(RL_S) as RL_S_SUM, '
  + 'sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, avg(LG_H) as LG_H_AVG, sum(LG_H) as LG_H_SUM, avg(LG_S) as LG_S_AVG, sum(LG_S) as LG_S_SUM, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, '
  + 'avg(RG_H) as RG_H_AVG, sum(RG_H) as RG_H_SUM, avg(RG_S) as RG_S_AVG, sum(RG_S) as RG_S_SUM '
  + 'from GamePlayer gp inner join Game g on g.ID=gp.GAME_ID '
  + 'where g.PUBLIC_ID="' + game + '" and team in (1,2) group by TEAM with rollup';
  dbpool.getConnection(function (err, conn) {
    if (err) { console.log(err); }
    conn.query(sql.join(';'), function (err, resulty) {
      if (err) { console.log(err); }
      conn.release();
      res.set('Cache-Control', 'public, max-age=' + http_cache_time);
      res.jsonp({ data: { game: resulty[0][0], teams: resulty[2], players: resulty[1] } });
      res.end();
    });
  });
});
/*
app.get('/api/games/:game/player/:player', function (req, res) {
	var game = mysql_real_escape_string( req.params.game );
	var nick = mysql_real_escape_string( req.params.player );
	var sql = 'SELECT PLAYER_NICK, PLAYER_CLAN, PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, sum(KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG FROM Players WHERE Players.PUBLIC_ID=\'' + game + '\' and Players.PLAYER_NICK=\''+ nick +'\' ';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { player: rows[0] } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/games/:game/tags', function( req, res ) {
	// move this to /game/* ?
	var game = mysql_real_escape_string( req.params.game );
	var sql = 'select tags.id, tags.name, game_tags.PUBLIC_ID from tags left join game_tags on tags.id=game_tags.tag_id where game_tags.PUBLIC_ID=\''+ game +'\'';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { tags: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
*/
app.get('/api/games/:game/get', function (req, res) {
  var publicId = req.params.game;
	var sql = 'select PUBLIC_ID from Game where PUBLIC_ID=?';
	var loader = require('./ldcore.js');
  var conn;
  Q.ninvoke(dbpool, "getConnection")
    .then(function(c) { conn = c; })
    .then(function() { return loader.init(conn, { useCache: false }); })
    .then(function() { return loader.query(sql, [publicId]); })
    .then(function(rows) {
      if (rows.length)
        throw new Error("already exist");
      return get_game(loader, publicId);
    })
    .then(function() {
      res.jsonp({ data: { PUBLIC_ID: publicId } });
      res.end();
    })
    .fail(function (err) {
      res.jsonp({ data: {}, error: err });
      res.end();
    })
    .finally(function() { conn.Release(); });
} );
app.get( '/api/games/:game/tag/add/:tag', function( req, res ) {
	// move this to /game/* ?
	var game = mysql_real_escape_string( req.params.game );
	var tag = mysql_real_escape_string( req.params.tag );
	// if game/tag exists...
	var sql = 'insert into game_tags( tag_id, PUBLIC_ID ) values( '+ tag +', \''+ game +'\' )';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.jsonp( { data: { rows: rows, err: err, fields: fields } } );
			res.end();
			conn.release();
		} );
	} );
} );
//app.get( '/api/game/*/tag/del/*',
app.get( '/api/owners', function ( req, res ) {
  var sql = 'SELECT o.NAME as OWNER, count(*) as MATCHES_PLAYED, sum(GAME_LENGTH) as GAME_LENGTH_SUM, avg(GAME_LENGTH) as GAME_LENGTH_AVG, sum(TOTAL_KILLS) as TOTAL_KILLS, avg(AVG_ACC) as AVG_ACC '
  + 'FROM Game g inner join Player o on o.ID=g.OWNER_ID group by o.NAME';
	if( req.route.path in CACHE ) {
		res.jsonp( { data: { owners: CACHE[req.route.path].data } } );
		res.end();
		if( CACHE[req.route.path].ts < new Date().getTime() &&
			!CACHE[req.route.path].fetching ) {
			CACHE[req.route.path].fetching = true;
			dbpool.getConnection( function( err, conn ) {
				conn.query( sql, function( err, rows ) {
					CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
					fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
						if( err ) { console.log( err ); }
					} );
				} );
			} );
		}
	}
	else {
		dbpool.getConnection( function( err, conn ) {
			conn.query( sql, function( err, rows ) {
				conn.release();
				CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
				fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
					if( err ) { console.log( err ); }
				} );
				res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
				res.jsonp( { data: { owners: rows } } );
				res.end();
			} );
		} );
	}
});
/*
app.get( '/api/owners/:owner/players', function ( req, res ) {
	var owner = mysql_real_escape_string( req.params.owner );
	// players
	//var sql = 'select Games.PUBLIC_ID, Games.OWNER, Players.PLAYER_NICK, Players.PLAYER_CLAN, Players.PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, avg(Players.DAMAGE_DEALT)/avg(Players.PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( Players.PLAY_TIME ) as PLAY_TIME, sum( Players.KILLS ) as KILLS, sum( Players.DEATHS ) as DEATHS, avg( Players.KILLS/Players.DEATHS ) as RATIO from Games left join Players on Games.PUBLIC_ID=Players.PUBLIC_ID where OWNER="'+ owner +'" group by Players.PLAYER_NICK;';
	var sql = 'select Players.PLAYER_NICK, Players.PLAYER_CLAN, Players.PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( PLAY_TIME ) as PLAY_TIME, sum( KILLS ) as KILLS, sum( DEATHS ) as DEATHS, avg( KILLS/DEATHS ) as RATIO from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID where Games.OWNER="'+ owner +'" group by Players.PLAYER_NICK order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { players: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/owners/:owner/clans', function ( req, res ) {
	var owner = mysql_real_escape_string( req.params.owner );
	sql = 'select Players.PLAYER_CLAN, count(*) as MATCHES_PLAYED, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( PLAY_TIME ) as PLAY_TIME, sum( KILLS ) as KILLS, sum( DEATHS ) as DEATHS, avg( KILLS/DEATHS ) as RATIO from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID where Games.OWNER="'+ owner +'" group by Players.PLAYER_CLAN order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + maxAge_api_long );
			res.jsonp( { data: { clans: rows, more: 'less' } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/owners/:owner/tags', function( req, res ) {
	// move this to /game/* ?
	var owner = mysql_real_escape_string( req.params.owner );
	var sql = 'select tags.id, tags.name, game_tags.PUBLIC_ID from tags left join game_tags on tags.id=game_tags.tag_id where game_tags.OWNER=\''+ owner +'\'';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { tags: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
//app.get( '/api/owner/*  ....  /clan/*'
app.get( '/api/owners/:owner/player/:player/games', function ( req, res ) {
	var owner = mysql_real_escape_string( req.params.owner );
	var nick = mysql_real_escape_string( req.params.player );
	var sql = 'select Games.PUBLIC_ID, Games.GAME_TIMESTAMP, Games.MAP, Games.GAME_TYPE, Games.OWNER, Games.RULESET, Games.RANKED, Games.PREMIUM, Players.PLAYER_NICK, DAMAGE_DEALT/PLAY_TIME as DAMAGE_DEALT_PER_SEC_AVG from Games left join Players on Games.PUBLIC_ID=Players.PUBLIC_ID where Players.PLAYER_NICK="'+ nick +'" and Games.OWNER=\''+ owner +'\' order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + maxAge_api_long );
			res.jsonp( { data: { games: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/owners/:owner/player/:player', function ( req, res ) {
	var owner = mysql_real_escape_string( req.params.owner );
	var nick = mysql_real_escape_string( req.params.player );
	var sql = 'SELECT PLAYER_NICK, PLAYER_CLAN, PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end) as MATCHES_WON, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end)/count(*)*100 as WIN_PERCENT, sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT/PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, sum(KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG FROM Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID WHERE Games.OWNER=\'' + owner + '\' and Players.PLAYER_NICK=\''+ nick +'\' GROUP BY PLAYER_NICK order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { player: rows[0] } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/owners/:owner/countries', function ( req, res ) {
	var owner = mysql_real_escape_string( req.params.owner );
	// players
	sql = 'select Players.PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( PLAY_TIME ) as PLAY_TIME, sum( KILLS ) as KILLS, sum( DEATHS ) as DEATHS, avg( KILLS/DEATHS ) as RATIO from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID where Games.OWNER="'+ owner +'" group by Players.PLAYER_COUNTRY order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { countries: rows, more: 'less' } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/owners/:owner/games', function ( req, res ) {
	var owner = mysql_real_escape_string( req.params.owner );
	sql = 'select * from Games where OWNER="'+ owner +'"';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { games: rows, more: 'less' } } );
			res.end();
			conn.release();
		} );
	} );
} );
*/
app.get( '/api/owners/:owner', function ( req, res ) {
	var sql;
	sql = 'SELECT o.NAME as OWNER, count(1) as MATCHES_PLAYED, sum(PREMIUM) as PREMIUM_COUNT, avg(GAME_LENGTH) as GAME_LENGTH_AVG,  sum(GAME_LENGTH) as GAME_LENGTH_SUM,'
	+ 'avg(NUM_PLAYERS) as NUM_PLAYERS_AVG, avg(TOTAL_KILLS) as TOTAL_KILLS_AVG, sum(TOTAL_KILLS) as TOTAL_KILLS_SUM, avg(DMG_DELIVERED_NUM) as DMG_DELIVERED_NUM_AVG, '
  + 'avg(TSCORE0) as TSCORE0_AVG, avg(TSCORE1) as TSCORE1_AVG '
  + 'FROM Game g inner join Player o on o.ID=g.OWNER_ID where o.NAME=?';
	//sql[1] = 'select MAP, count(*) as MATCHES_PLAYED from Games where OWNER="'+ owner +'" group by MAP order by NULL';
	// unique players
	//sql[1] = 'select count(*) as UNIQUE_PLAYERS from ( select PLAYER_NICK from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID where Games.OWNER="'+ owner +'" group by PLAYER_NICK order by NULL ) as a';
	// game types
	//sql[3] = 'select count(*) as MATCHES_PLAYED, GAME_TYPE from Games where OWNER="'+ owner +'" group by GAME_TYPE order by NULL';
	// players
	//sql[4] = 'select Players.PLAYER_NICK, count(*) as MATCHES_PLAYED, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( PLAY_TIME ) as PLAY_TIME, sum( KILLS ) as KILLS from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID where Games.OWNER="'+ owner +'" group by Players.PLAYER_NICK order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, [ req.params.owner], function( err2, rows ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { owner: rows[0] } } );
			res.end();
			conn.release();
		} );
	} );
} );
/*
app.get( '/api/clans', function ( req, res ) {
	var sql = 'select Players.PLAYER_CLAN as PLAYER_CLAN, count(*) as MATCHES_PLAYED, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, avg(RANK) as RANK_AVG, sum(Players.KILLS) as KILLS, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, sum(Players.PLAY_TIME) as PLAY_TIME, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG from Players GROUP BY Players.PLAYER_CLAN ORDER BY NULL';
	//var sql = 'select Players.PLAYER_CLAN as PLAYER_CLAN, count(*) as MATCHES_PLAYED, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, avg(RANK) as RANK_AVG, sum(Players.KILLS) as KILLS, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, sum(Players.PLAY_TIME) as PLAY_TIME, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID GROUP BY Players.PLAYER_CLAN ORDER BY NULL';
	//var sql = 'select Players.PLAYER_CLAN as PLAYER_CLAN, count(*) as MATCHES_PLAYED, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end)/count(*)*100 as WIN_PERCENT, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(Players.KILLS) as KILLS, sum(Players.DEATHS) as DEATHS, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO,sum(Players.HITS) as HITS, avg(Players.HITS) as HITS_AVG,sum(Players.SHOTS) as SHOTS,avg(Players.SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, sum(Players.PLAY_TIME) as PLAY_TIME,sum(Players.EXCELLENT) as EXCELLENT_SUM, avg(Players.EXCELLENT) as EXCELLENT_AVG, sum(Players.IMPRESSIVE) as IMPRESSIVE_SUM, avg(Players.IMPRESSIVE) as IMPRESSIVE_AVG,sum(Players.HUMILIATION) as HUMILIATION_SUM, avg(Players.HUMILIATION) as HUMILIATION_AVG,sum(Players.DAMAGE_DEALT) as DAMAGE_DEALT,avg(Players.DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(Players.DAMAGE_TAKEN) as DAMAGE_TAKEN, avg(Players.DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID GROUP BY Players.PLAYER_CLAN ORDER BY NULL';
	db.query( sql, function( err, rows ) {
		res.jsonp( { data: { clans: rows } } );
		res.end();
	} );
} );
app.get( '/api/clan/*', function ( req, res ) {
	var str1 = '';
	var str2 = '';
	var clan = req.url.split( '/' );
	clan.shift(); clan.shift(); clan.shift();
	clan = decodeURI( clan.join( '' ) );
	var sql = [];
	sql[0] = 'SELECT PLAYER_CLAN, count(*) as MATCHES_PLAYED, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end) as MATCHES_WON, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end)/count(*)*100 as WIN_PERCENT, sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, sum(KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG FROM Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID WHERE '+str1+str2+' PLAYER_CLAN=\''+ clan +'\' GROUP BY PLAYER_CLAN order by null';
	sql[1] = 'SELECT PLAYER_NICK, PLAYER_COUNTRY, count(PLAYER_NICK) as MATCHES_PLAYED, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end) as MATCHES_WON, sum(case when Players.TEAM = Games.WINNING_TEAM then 1 else 0 end)/count(*)*100 as WIN_PERCENT, sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, sum(KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG FROM Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID WHERE '+str1+str2+' PLAYER_CLAN=\''+ clan +'\' GROUP BY PLAYER_NICK, PLAYER_CLAN order by null';
	db.query( sql.join( ';' ), function( err, resulty ) {
		res.jsonp( { data: { clan: resulty[0][0], players: resulty[1] } } );
		res.end();
	} );
} );
app.get( '/api/all/daily', function ( req, res ) {
	// maps
	sql = 'select count(*) as count, DATE(from_unixtime(GAME_TIMESTAMP)) as date, year(from_unixtime(GAME_TIMESTAMP)) as year, month(from_unixtime(GAME_TIMESTAMP)) as month, day(from_unixtime(GAME_TIMESTAMP)) as day from Games group by year,month,day order by NULL';
	db.query( sql, function( err, rows, fields ) {
		res.jsonp( { thedays: rows } );
		res.end();
	} );
} );
app.get( '/api/all/maps', function ( req, res ) {
	// maps
	sql = 'select count(*) as MATCHES_PLAYED, MAP from Games group by MAP order by MATCHES_PLAYED desc';
	db.query( sql, function( err, rows, fields ) {
		res.jsonp( { themaps: rows } );
		res.end();
	} );
} );
app.get( '/api/all', function ( req, res ) {
	//var game = mysql_real_escape_string( req.url.split( '/' )[3] );
	var sql = [];
	// games
	sql[0] = 'SELECT count(*) as MATCHES_PLAYED, SUM(TOTAL_KILLS) as TOTAL_KILLS, avg(AVG_ACC) as AVG_ACC FROM Games';
	// players
	sql[1] = 'SELECT sum(PLAY_TIME) as PLAY_TIME_SUM, sum(SHOTS) as SHOTS, sum(KILLS) as KILLS, sum(RL_K) as RL_K_SUM, sum(RG_K) as RG_K_SUM, sum(LG_K) as LG_K_SUM FROM Players ';
	// UNIQUE_PLAYERS
	sql[2] = 'select count(*) as UNIQUE_PLAYERS from ( select PLAYER_NICK from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID group by PLAYER_NICK ) as a';
	// first/latest game
	sql[3] = 'select min(GAME_TIMESTAMP) as min, max(GAME_TIMESTAMP) as max from Games';
	// types
	sql[4] = 'select GAME_TYPE, count(*) as MATCHES_PLAYED from Games group by GAME_TYPE order by MATCHES_PLAYED desc';
	db.query( sql.join( ';' ), function( err, resulty ) {
		res.jsonp( { games: resulty[0], UNIQUE_PLAYERS: resulty[2], min_max: resulty[3], gametypes: resulty[4], players: resulty[1] } );
		res.end();
	} );
} );
app.get( '/api/maps', function ( req, res ) {
	var sql = 'SELECT MAP, count(*) as MATCHES_PLAYED, sum(TOTAL_KILLS) as TOTAL_KILLS, sum(GAME_LENGTH) as GAME_LENGTH FROM Games group by MAP order by NULL';
	db.query( sql, function( err, rows, fields ) {
		res.jsonp( { data: { maps: rows } } );
		res.end();
	} );
} );
app.get( '/api/map/*', function ( req, res ) {
	var map = mysql_real_escape_string( req.url.split( '/' )[3] );
	var sql = [];
	sql[0] = 'SELECT MAP, count(*) as MATCHES_PLAYED FROM Games WHERE MAP=\'' + map + '\' group by MAP';
	//sql[1] = 'SELECT * FROM Players WHERE MAP=\'' + map + '\'';
	//sql[2] = 'select Players.TEAM, count(Players.PLAYER_NICK) as PLAYERS, sum(Players.SCORE) as SCORE, avg(Players.SCORE) as SCORE_AVG, sum(Players.KILLS) as KILLS, sum(Players.DEATHS) as DEATHS, sum(Players.SHOTS) as SHOTS, sum(Players.HITS) as HITS, sum(Players.DAMAGE_DEALT) as DAMAGE_DEALT_SUM, sum(Players.DAMAGE_DEALT)/sum(Games.GAME_LENGTH) as DAMAGE_DEALT_PER_SEC_AVG, sum(Players.DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM from Players left join Games on Players.PUBLIC_ID=Games.PUBLIC_ID where Players.PUBLIC_ID="'+ game +'" group by TEAM';
	db.query( sql.join( ';' ), function( err, resulty ) {
		res.jsonp( { data: { map: resulty[0], teams: resulty[2], players: resulty[1] } } );
		res.end();
	} );
} );
app.get( '/api/countries', function ( req, res ) {
	sql = 'select Players.PLAYER_COUNTRY, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( PLAY_TIME ) as PLAY_TIME, sum( KILLS ) as KILLS, sum( DEATHS ) as DEATHS, avg( KILLS/DEATHS ) as RATIO from Players group by Players.PLAYER_COUNTRY order by NULL';
	db.query( sql, function( err, rows, fields ) {
		res.jsonp( { thecountries: rows, more: 'less' } );
		res.end();
	} );
} );
*/
app.get( '/api/gametypes', function ( req, res ) {
	var sql = 'SELECT GAME_TYPE, count(1) as MATCHES_PLAYED, sum(GAME_LENGTH) as GAME_LENGTH FROM Game group by GAME_TYPE order by 1';
	if( req.route.path in CACHE ) {
		res.jsonp( { data: { gametypes: CACHE[req.route.path].data } } );
		res.end();
		if( CACHE[req.route.path].ts < new Date().getTime() &&
			!CACHE[req.route.path].fetching ) {
			CACHE[req.route.path].fetching = true;
			dbpool.getConnection( function( err, conn ) {
				conn.query( sql, function( err, rows, fields ) {
					CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
					fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
						if( err ) { console.log( err ); }
					} );
				} );
			} );
		}
	}
	else {
		dbpool.getConnection( function( err, conn ) {
			conn.query( sql, function( err, rows, fields ) {
				CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
				fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
					if( err ) { console.log( err ); }
				} );
				res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
				res.jsonp( { data: { gametypes: rows } } );
				res.end();
				conn.release();
			} );
		} );
	}
} );
app.get( '/api/gametypes/:gametype', function ( req, res ) {
	var sql = 'SELECT GAME_TYPE, count(1) as MATCHES_PLAYED, avg(GAME_LENGTH) as GAME_LENGTH, avg(NUM_PLAYERS) as NUM_PLAYERS from Game where GAME_TYPE=? group by GAME_TYPE';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, [req.params.gametype], function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { gametypes: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/overview', function ( req, res ) {
	var sql = 'select GAME_TYPE, count(1) as MATCHES_PLAYED, sum(GAME_LENGTH) as GAME_LENGTH, sum(TOTAL_KILLS) as TOTAL_KILLS from Game group by GAME_TYPE order by 1';
	if( req.route.path in CACHE ) {
		res.jsonp( { data: { overview: CACHE[req.route.path].data } } );
		res.end();
		if( CACHE[req.route.path].ts < new Date().getTime() &&
			!CACHE[req.route.path].fetching ) {
			CACHE[req.route.path].fetching = true;
			dbpool.getConnection( function( err, conn ) {
				conn.query( sql, function( err, rows, fields ) {
					CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
					fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
						if( err ) { console.log( err ); }
					} );
				} );
			} );
		}
	}
	else {
		dbpool.getConnection( function( err, conn ) {
			conn.query( sql, function( err, rows, fields ) {
				CACHE[req.route.path] = { ts: new Date().getTime() + maxAge_api_long, data: rows, fetching: false };
				fs.writeFile( cachefile, JSON.stringify( CACHE ), function( err ) {
					if( err ) { console.log( err ); }
				} );
				res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
				res.jsonp( { data: { overview: rows } } );
				res.end();
				conn.release();
			} );
		} );
	}
});
/*
app.get( '/api/tags', function ( req, res ) {
	var sql = 'SELECT id, name, count(*) as tagged_games FROM tags left join game_tags on tags.id=game_tags.tag_id group by id';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { tags: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/tags/:tag/games', function ( req, res ) {
	var tag = mysql_real_escape_string( req.params.tag );
	var sql = [];
	sql = 'SELECT * FROM Games left join game_tags on Games.PUBLIC_ID=game_tags.PUBLIC_ID where game_tags.tag_id=' + tag + ' ';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { games: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/tags/:tag/owners', function ( req, res ) {
	var tag = mysql_real_escape_string( req.params.tag );
	var sql = 'SELECT OWNER, count(*) as MATCHES_PLAYED, sum(GAME_LENGTH) as GAME_LENGTH_SUM, avg(GAME_LENGTH) as GAME_LENGTH_AVG, sum(TOTAL_KILLS) as TOTAL_KILLS, avg(AVG_ACC) as AVG_ACC FROM Games left join game_tags on Games.PUBLIC_ID=game_tags.PUBLIC_ID where game_tags.tag_id='+ tag +' group by OWNER order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { owners: rows } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/tags/:tag/players/:player', function ( req, res ) {
	var tag = mysql_real_escape_string( req.params.tag );
	var nick = mysql_real_escape_string( req.params.player );
	//var sql = 'select * from Players left join game_tags on Players.PUBLIC_ID=game_tags.PUBLIC_ID where game_tags.tag_id='+ tag +' and Players.PLAYER_NICK=\''+ nick +'\'';
	var sql = 'SELECT PLAYER_NICK, PLAYER_CLAN, PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, sum(QUIT) as QUIT_SUM, avg(QUIT) as QUIT_AVG, avg(RANK) as RANK_AVG, sum(SCORE) as SCORE_SUM, avg(SCORE) as SCORE_AVG, sum(DAMAGE_DEALT) as DAMAGE_DEALT_SUM, avg(DAMAGE_DEALT) as DAMAGE_DEALT_AVG, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, sum(DAMAGE_TAKEN) as DAMAGE_TAKEN_SUM, avg(DAMAGE_TAKEN) as DAMAGE_TAKEN_AVG, avg(DAMAGE_DEALT-DAMAGE_TAKEN) as DAMAGE_NET_AVG, sum(KILLS) as KILLS_SUM, avg(KILLS) as KILLS_AVG, sum(DEATHS) as DEATHS_SUM, avg(DEATHS) as DEATHS_AVG, sum(Players.KILLS)/sum(Players.DEATHS) as RATIO, sum(HITS) as HITS_SUM, avg(HITS) as HITS_AVG, sum(SHOTS) as SHOTS_SUM, avg(SHOTS) as SHOTS_AVG, sum(HITS)/sum(SHOTS)*100 as ACC_AVG, avg(RANK) as RANK_AVG, avg(TEAM_RANK) as TEAM_RANK_AVG, sum(HUMILIATION) as HUMILIATION_SUM, avg(HUMILIATION) as HUMILIATION_AVG, sum(IMPRESSIVE) as IMPRESSIVE_SUM, avg(IMPRESSIVE) as IMPRESSIVE_AVG, sum(EXCELLENT) as EXCELLENT_SUM, avg(EXCELLENT) as EXCELLENT_AVG, sum(PLAY_TIME) as PLAY_TIME_SUM, avg(PLAY_TIME) as PLAY_TIME_AVG, sum(G_K) as G_K_SUM, avg(G_K) as G_K_AVG, sum(GL_H) as GL_H_SUM, avg(GL_H) as GL_H_AVG, sum(GL_K) as GL_K_SUM, avg(GL_K) as GL_K_AVG, sum(GL_S) as GL_S_SUM, avg(GL_S) as GL_S_AVG, sum(LG_H) as LG_H_SUM, avg(LG_H) as LG_H_AVG, sum(LG_K) as LG_K_SUM, avg(LG_K) as LG_K_AVG, sum(LG_S) as LG_S_SUM, avg(LG_S) as LG_S_AVG, sum(MG_H) as MG_H_SUM, avg(MG_H) as MG_H_AVG, sum(MG_K) as MG_K_SUM, avg(MG_K) as MG_K_AVG, sum(MG_S) as MG_S_SUM, avg(MG_S) as MG_S_AVG, sum(PG_H) as PG_H_SUM, avg(PG_H) as PG_H_AVG, sum(PG_K) as PG_K_SUM, avg(PG_K) as PG_K_AVG, sum(PG_S) as PG_S_SUM, avg(PG_S) as PG_S_AVG, sum(RG_H) as RG_H_SUM, avg(RG_H) as RG_H_AVG, sum(RG_K) as RG_K_SUM, avg(RG_K) as RG_K_AVG, sum(RG_S) as RG_S_SUM, avg(RG_S) as RG_S_AVG, sum(RL_H) as RL_H_SUM, avg(RL_H) as RL_H_AVG, sum(RL_K) as RL_K_SUM, avg(RL_K) as RL_K_AVG, sum(RL_S) as RL_S_SUM, avg(RL_S) as RL_S_AVG, sum(SG_H) as SG_H_SUM, avg(SG_H) as SG_H_AVG, sum(SG_K) as SG_K_SUM, avg(SG_K) as SG_K_AVG, sum(SG_S) as SG_S_SUM, avg(SG_S) as SG_S_AVG FROM Players left join game_tags on Players.PUBLIC_ID=game_tags.PUBLIC_ID where game_tags.tag_id='+ tag +' and Players.PLAYER_NICK=\''+ nick +'\' GROUP BY PLAYER_NICK order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { player: rows[0] } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/tags/:tag', function ( req, res ) {
	var tag = mysql_real_escape_string( req.params.tag );
	sql = 'SELECT * FROM tags WHERE id=' + tag + '';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { tag: rows[0] } } );
			res.end();
			conn.release();
		} );
	} );
} );
app.get( '/api/tags/:tag/players', function ( req, res ) {
	var tag = mysql_real_escape_string( req.params.tag );
	// players
	sql = 'select Players.PLAYER_NICK, Players.PLAYER_CLAN, Players.PLAYER_COUNTRY, count(*) as MATCHES_PLAYED, avg(DAMAGE_DEALT)/avg(PLAY_TIME) as DAMAGE_DEALT_PER_SEC_AVG, avg( Players.HITS/Players.SHOTS*100 ) as ACC, sum( PLAY_TIME ) as PLAY_TIME, sum( KILLS ) as KILLS, sum( DEATHS ) as DEATHS, avg( KILLS/DEATHS ) as RATIO from Players left join game_tags on Players.PUBLIC_ID=game_tags.PUBLIC_ID where game_tags.tag_id="'+ tag +'" group by Players.PLAYER_NICK order by NULL';
	dbpool.getConnection( function( err, conn ) {
		conn.query( sql, function( err, rows, fields ) {
			res.set( 'Cache-Control', 'public, max-age=' + http_cache_time );
			res.jsonp( { data: { players: rows, more: 'less' } } );
			res.end();
			conn.release();
		} );
	} );
} );
*/
app.get( '/api/status/cache', function ( req, res ) {
	res.set( 'Cache-Control', 'public, max-age=' + maxAge_api );
	var _cache = [];
	var now = new Date().getTime();
	for( var i in CACHE ) {
		_cache.push( { route: i, ts: CACHE[i].ts, diff: CACHE[i].ts - now } );
	}
	res.jsonp( { now: now, size: roughSizeOfObject( CACHE ), cached: _cache } );
	res.end();
} );
app.get( '/status', function ( req, res ) {
	var queryObject = url.parse( req.url, true ).query;
	res.jsonp( { requests_counter_total: requests_counter_total, requests_counter: requests_counter, requests_counter_api: requests_counter_api, requests_counter_pub: requests_counter_pub, process_uptime: process.uptime() } );
	res.end();
	if( typeof queryObject.cacti != 'undefined' ) {
		requests_counter = 0;
		requests_counter_api = 0;
		requests_counter_pub = 0;
	}
});
app.get('/api/race', function (req, res) {
  sql = "select m.NAME MAP,MODE,p.NAME PLAYER_NICK,SCORE from Race r inner join Map m on m.ID=r.MAP_ID inner join Player p on p.ID=r.PLAYER_ID where RANK=1 order by 1"; 
  dbpool.getConnection(function (err, conn) {
    conn.query(sql, function (err2, rows) {
      var mapDict = {};
      var maps = [];
      res.set('Cache-Control', 'public, max-age=' + http_cache_time);
      for (var i = 0, c = rows.length; i < c; i++) {
        var row = rows[i];
        var map = mapDict[row.MAP];
        if (!map) {
          map = { MAP: row.MAP, LEADERS: [] }
          mapDict[row.MAP] = map;
          maps.push(map);
        }
        map.LEADERS[row.MODE] = { MODE: row.MODE, PLAYER_NICK: row.PLAYER_NICK, SCORE: row.SCORE };
      }
      res.jsonp({ data: { maps: maps, more: 'less' } });
      res.end();
      conn.release();
    });
  });
});
app.get('/api/race/maps/:map', function (req, res) {
  var queryObject = url.parse(req.url, true).query;
  var _mapName = req.params.map;
  var _ruleset = queryObject.ruleset == "vql" ? 2 : 0;
  var _weapons = queryObject.weapons == "off" ? 1 : 0;
  var _limit = parseInt(queryObject.limit);
  var _player = queryObject.player;

  sql = "select m.NAME MAP,p.NAME PLAYER_NICK,SCORE,from_unixtime(r.GAME_TIMESTAMP) GAME_TIMESTAMP,RANK,g.PUBLIC_ID "
    + "from Race r inner join Map m on m.ID=r.MAP_ID inner join Player p on p.ID=r.PLAYER_ID left outer join Game g on g.ID=r.GAME_ID where m.NAME=? and MODE=?";
  if(_limit)
    sql += " and (RANK<=? or p.NAME=?)";
  sql += " order by RANK";
  dbpool.getConnection(function (err, conn) {
    conn.query(sql, [_mapName, _ruleset + _weapons, _limit, _player], function (err, rows, fields) {
      if( err ) throw err;
      res.set('Cache-Control', 'public, max-age=' + http_cache_time);
      res.jsonp({ data: { ruleset: _ruleset ? "vql" : "pql", weapons: _weapons ? "on" : "off", scores: rows } });
      res.end();
      conn.release();
    });
  });
});
app.get('/api/race/players/:player', function (req, res) {
  var queryObject = url.parse(req.url, true).query;
  var _playerNick = req.params.player;
  var _ruleset = queryObject.ruleset == "vql" ? 2 : 0;
  var _weapons = queryObject.weapons == "off" ? 1 : 0;
  var _mapName = queryObject.map;

  sql = "select m.NAME MAP,p.NAME PLAYER_NICK,r.SCORE,from_unixtime(r.GAME_TIMESTAMP) GAME_TIMESTAMP,r.RANK,g.PUBLIC_ID, " +
    " leader.NAME LEADER_NICK,best.SCORE LEADER_SCORE" +
    " from Race r inner join Player p on p.ID=r.PLAYER_ID inner join Map m on m.ID=r.MAP_ID left outer join Game g on g.ID=r.GAME_ID " +
    " left outer join Race best on best.MAP_ID=r.MAP_ID and best.MODE=r.mode and best.RANK=1 left outer join Player leader on leader.ID=best.PLAYER_ID" +
    " where p.NAME=? and r.MODE=?";
  if (queryObject.map)
    sql += " and m.NAME=?";
  sql += " order by m.NAME";

  dbpool.getConnection(function(err, conn) {
    conn.query(sql, [_playerNick, _ruleset + _weapons, _mapName], function(err2, rows) {
      res.set('Cache-Control', 'public, max-age=' + http_cache_time);
      res.jsonp({ data: { ruleset: _ruleset ? "vql" : "pql", weapons: _weapons ? "off" : "on", scores: rows } });
      conn.release();
      res.end();
    });
  });
});

/*
app.get( '*', function ( req, res ) {
	res.sendfile( './public/index.html' );
} );
*/

app.listen( cfg.api.port );

// escape chars
function mysql_real_escape_string( str ) {
	return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
		switch( char ) {
			case "\0":
				return "\\0";
			case "\x08":
				return "\\b";
			case "\x09":
				return "\\t";
			case "\x1a":
				return "\\z";
			case "\n":
				return "\\n";
			case "\r":
				return "\\r";
			case "\"":
			case "'":
			case "\\":
			case "%":
				return "\\"+char; // prepends a backslash to backslash, percent,
				// and double/single quotes
		}
	} );
}

// elapsed time
function elapsed_time2( timer ) {
	var precision = 3; // 3 decimal places
	var elapsed = process.hrtime( timer )[1] / 1000000; // divide by a million to get nano to milli
	timer = process.hrtime(); // reset the timer
	return parseFloat( elapsed.toFixed( precision ) );
}

//
var MyRequestsCompleted = ( function() {
	var numRequestToComplete, requestsCompleted, callBacks, singleCallBack;
	return function( options ) {
		if( !options ) {
			options = {};
		}
		numRequestToComplete = options.numRequest || 0;
		requestsCompleted = options.requestsCompleted || 0;
		callBacks = [];
		var fireCallbacks = function () {
			for( var i = 0; i < callBacks.length; i++ ) {
				callBacks[i]();
			}
		};
		if( options.singleCallback ) {
			callBacks.push( options.singleCallback );
		}
		this.addCallbackToQueue = function( isComplete, callback ) {
			if( isComplete ) requestsCompleted++;
			if( callback ) callBacks.push( callback );
			if( requestsCompleted == numRequestToComplete ) fireCallbacks();
		};
		this.requestComplete = function( isComplete ) {
			if( isComplete ) requestsCompleted++;
			if( requestsCompleted == numRequestToComplete ) {
				fireCallbacks();
			}
		};
		this.setCallback = function( callBack ) {
			callBacks.push( callBack );
		};
	};
} )();

// number
function isNumber( n ) {
	return !isNaN( parseFloat( n ) ) && isFinite( n );
}

// get game

function get_game(loader, game_public_id) {
	var url2 = 'http://www.quakelive.com/stats/matchdetails/' + "";
	request( url2 + game_public_id, function( err, resp, body ) {
		var j = JSON.parse( body );
		// save to disk
		if( j.UNAVAILABLE != 1 ) {
		  return loader.processGame(j);
		}
	  return Q(undefined);
	} );
}

// 
function roughSizeOfObject( object ) {
	var objectList = [];
	var stack = [ object ];
	var bytes = 0;
	while ( stack.length ) {
		var value = stack.pop();
		if ( typeof value === 'boolean' ) {
			bytes += 4;
		}
		else if ( typeof value === 'string' ) {
			bytes += value.length * 2;
		}
		else if ( typeof value === 'number' ) {
			bytes += 8;
		}
		else if ( typeof value === 'object' && objectList.indexOf( value ) === -1) {
			objectList.push( value );
			for( var i in value ) {
				stack.push( value[ i ] );
			}
		}
	}
	return bytes;
}

