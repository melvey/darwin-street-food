import 'whatwg-fetch';
import loadList from './load-list';
import tidyList from './tidy-list';
import drawDays from './draw-days';

const list = undefined;

loadList()
	.then(tidyList)
	.then(drawDays);

