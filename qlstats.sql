CREATE DATABASE qls CHARACTER SET ascii;
use qls;

DROP TABLE IF EXISTS Map;
CREATE TABLE Map(
  ID integer NOT NULL auto_increment,
  NAME varchar(24) not null,
--
  PRIMARY KEY( ID )
) CHARACTER SET ascii ENGINE=MyISAM;

DROP TABLE IF EXISTS Clan;
CREATE TABLE Clan(
  ID integer NOT NULL auto_increment,
  NAME varchar(16) not null,
--
  PRIMARY KEY( ID )
) CHARACTER SET ascii ENGINE=MyISAM;

DROP TABLE IF EXISTS Player;
CREATE TABLE Player(
  ID integer NOT NULL auto_increment,
  NAME varchar(16) not null,
  CLAN_ID integer,
  COUNTRY char(2),
--
  PRIMARY KEY( ID ),
  UNIQUE KEY IX_NAME( NAME )
) CHARACTER SET ascii ENGINE=MyISAM;


DROP TABLE IF EXISTS Game;
CREATE TABLE Game(
  ID integer NOT NULL auto_increment,
	PUBLIC_ID varchar(36) NOT NULL,
	OWNER_ID integer,
	MAP_ID integer NOT NULL,
	NUM_PLAYERS tinyint,
	AVG_ACC tinyint,
	PREMIUM tinyint(1),
	RANKED tinyint(1) NOT NULL,
	RESTARTED tinyint(1),
	RULESET tinyint,
	TIER tinyint,
	TOTAL_KILLS smallint,
	TOTAL_ROUNDS tinyint,
	WINNING_TEAM tinyint,
	TSCORE0 smallint,
	TSCORE1 smallint,
	FIRST_SCORER_ID integer,
	LAST_SCORER_ID integer,
	GAME_LENGTH smallint,
	GAME_TYPE varchar(9) NOT NULL,
	GAME_TIMESTAMP integer,
	DMG_DELIVERED_ID integer,
	DMG_DELIVERED_NUM integer,
	DMG_TAKEN_ID integer,
	DMG_TAKEN_NUM integer,
	LEAST_DEATHS_ID integer,
	LEAST_DEATHS_NUM smallint,
	MOST_DEATHS_ID integer,
	MOST_DEATHS_NUM smallint,
	MOST_ACCURATE_ID integer,
	MOST_ACCURATE_NUM tinyint,
--
	PRIMARY KEY( ID ),
  UNIQUE KEX( PUBLIC_ID ),
	KEY IX_GAMETYPE_MAP( GAME_TYPE, MAP_ID )
) CHARACTER SET ascii ENGINE=MyISAM;
CREATE INDEX IX_TIMESTAMP on Game(GAME_TIMESTAMP);

DROP TABLE IF EXISTS GamePlayer;
CREATE TABLE GamePlayer(
  ID integer NOT NULL auto_increment,
	GAME_ID integer NOT NULL,
	PLAYER_ID integer NOT NULL,
	CLAN_ID integer,
	QUIT tinyint(1),
	RANK tinyint,
	SCORE integer,
	DAMAGE_DEALT integer,
	DAMAGE_TAKEN integer,
	KILLS smallint,
	DEATHS smallint,
	HITS integer,
	SHOTS integer,
	TEAM tinyint,
	TEAM_RANK tinyint,
	HUMILIATION smallint,
	IMPRESSIVE smallint,
	EXCELLENT smallint,
	PLAY_TIME smallint,
	G_K smallint,
        BFG_S int,
        BFG_H int,
        BFG_K smallint,
        CG_S int,
        CG_H int,
	CG_K smallint,
	GL_S int,
	GL_H int,
	GL_K smallint,
	LG_S int,
	LG_H int,
	LG_K smallint,
	MG_S int,
	MG_H int,
	MG_K smallint,
	NG_S int,
	NG_H int,
	NG_K smallint,
	PG_S int,
	PG_H int,
	PG_K smallint,
	PM_S int,
	PM_H int,
	PM_K smallint,
	RG_S int,
	RG_H int,
	RG_K smallint,
	RL_S int,
	RL_H int,
	RL_K smallint,
	SG_S int,
	SG_H int,
	SG_K smallint,
--
	PRIMARY KEY( ID ),
	KEY IX_GAME_PLAYER( GAME_ID, PLAYER_ID ),
  KEY IX_PLAYER_ID( PLAYER_ID )
) CHARACTER SET ascii ENGINE=MyISAM;


DROP TABLE IF EXISTS Race;
CREATE TABLE Race (MODE int not null, MAP_ID integer not null, SCORE integer not null, PLAYER_ID integer not null, RANK integer not null, GAME_TIMESTAMP integer not null, GAME_ID integer) CHARACTER SET ascii engine=MyISAM;
CREATE INDEX IX_RaceMap on Race (MAP_ID, MODE, RANK);
CREATE INDEX IX_RacePlayer on Race (PLAYER_ID, MODE);

create view Games as 
select g.*,m.NAME as MAP 
from Game g 
inner join Map m on m.ID=g.MAP_ID;

drop view if exists Players;
create view Players as
select g.PUBLIC_ID,gp.*,p.NAME as PLAYER_NICK,c.NAME as PLAYER_CLAN,p.COUNTRY as PLAYER_COUNTRY
from GamePlayer gp
inner join Game g on g.ID=gp.GAME_ID
inner join Player p on p.ID=gp.PLAYER_ID
inner join Clan c on c.ID=gp.CLAN_ID;
