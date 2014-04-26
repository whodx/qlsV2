ql-stats
========

Collects game stats from quakelive.com


#Installation

* Clone this repo
* Goto your local copy and run `npm install`
* Create a database for ql-stats
* Setup the database by importing `qlstats.sql` to the database
* Rename cfg.json.sample to cfg.json and change the settings to suit your needs
* Run `npm start`
* Go to `http://<ip>:<port>/` 
* Get started by updating your latest matches by going to `http://ip:port/api/players/<YOUR-QL-NICKNAME>/update`



