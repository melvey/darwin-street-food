import ejs from 'ejs';
import timeConvert from './time-convert';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let templateString = undefined;
let template = undefined;
let target = undefined;
let data = undefined;

const setData = (dayData) => data = dayData;
const getData = () => data;

const getTarget = () => {
	if(!target) {
		target = document.querySelector('.day__container');
	}
	return target;
};

const renderDay = (data) => {
	if(!template) {
		templateString = document.getElementById('dayTemplate').innerHTML;
		template = ejs.compile(templateString);
	}

	const html = template(data);
	const templateElem = document.createElement('template');
	templateElem.innerHTML = html.trim();
	return templateElem.content.firstChild;
};

function drawDay(day, vendors, classes) {
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
						day,
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

	const next = content.querySelector('.day__next-btn');
	next.addEventListener('click', nextDay);
	const prev = content.querySelector('.day__prev-btn');
	prev.addEventListener('click', prevDay);

	if(classes) {
		const classArr = Array.isArray(classes) ? classes : [classes];
		classArr.forEach((className) => {
			content.classList.add(className);
		});
	}

	return content;
}

function drawDays(dayData) {
	setData(dayData);
	getTarget().innerHTML = null;

	var now = new Date();
	var today = now.getDay();
	var yesterday = today > 0 ? today - 1 : 6;
	var tomorrow = today < 6 ? today + 1 : 0;

	getTarget().appendChild(
		drawDay(yesterday, dayData)
	);
	getTarget().appendChild(
		drawDay(today, dayData)
	)
	getTarget().appendChild(
		drawDay(tomorrow, dayData)
	);


}

function nextDay() {
	const target = getTarget();
	const days = target.childNodes;
	const lastDay = days[days.length - 1];
	const dayIndex = parseInt(lastDay.dataset.day);
	const nextDay = dayIndex < 6 ? dayIndex + 1 : 0;
	const day = drawDay(nextDay, getData());
	const listen = (evt) => {
		target.classList.remove('day--next');
		target.removeEventListener('transitionend', listen);
		target.removeChild(days[0]);
		target.appendChild(day);
	};
	
	target.addEventListener('transitionend', listen);
	target.classList.add('day--next');
}

function prevDay() {
	const target = getTarget();
	const days = target.childNodes;
	const firstDay = days[0];
	const dayIndex = parseInt(firstDay.dataset.day);
	const nextDay = dayIndex > 0 ? dayIndex - 1 : 6;
	const day = drawDay(nextDay, getData());
	const listen = () => {
		target.classList.remove('day--previous');
		target.removeEventListener('transitionend', listen);
		target.removeChild(days[days.length - 1]);
		target.prepend(day);
	};
	
	target.addEventListener('transitionend', listen);
	target.classList.add('day--previous');
}

export default drawDays;
