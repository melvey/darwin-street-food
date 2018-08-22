import ejs from 'ejs';
import timeConvert from './time-convert';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let templateString = undefined;
let template = undefined;
let target = undefined;

const getTarget = () => {
	if(!target) {
		target = document.querySelector('main');
	}
	return target;
};

const renderDay = (data) => {
	if(!template) {
		templateString = document.getElementById('dayTemplate').innerHTML;
		template = ejs.compile(templateString);
	}

	return template(data);
};

function drawDay(day, vendors) {
	var open = [];

	vendors.forEach((vendor) => {
		var openIndex = vendor.locations.findIndex(
			(location) => location.days[day].open
		);

		if(openIndex >= 0) {
			var openLocation = vendor.locations[openIndex];
			var openDay = openLocation.days[day];

			open.push(Object.assign(
				{},
				vendor,
				{
					openLocation,
					openDay: {
						day: openDay.day,
						start: timeConvert(openDay.start),
						end: timeConvert(openDay.end)
					}
				}
			));
		}

	});

	const content = renderDay({
		day: days[day],
		dayIndex: day,
		vendors: open
	});

	getTarget().innerHTML += content;
	console.log(content);

}

function drawDays(dayData) {
	getTarget().innerHTML = null;

	var now = new Date();
	var today = now.getDay();

	drawDay(today, dayData);


}

export default drawDays;
