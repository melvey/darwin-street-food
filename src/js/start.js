import 'whatwg-fetch';
import loadList from './load-list';
import tidyList from './tidy-list';
import drawDays from './draw-days';
import DBHandler from './db-handler';

const dbHandler = new DBHandler();

dbHandler.getAllData()
	.then(drawDays);

const fetchVendors = loadList()
	.then(tidyList);

fetchVendors.then(drawDays);
fetchVendors.then(dbHandler.saveData);
