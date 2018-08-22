
/**
* Convert a 24 hour time to 12 hour
* from https://stackoverflow.com/questions/13898423/javascript-convert-24-hour-time-of-day-string-to-12-hour-time-with-am-pm-and-no
* @param {string} time A 24 hour time string
* @return {string} A formatted 12 hour time string
**/
function tConvert (time) {
	// Check correct time format and split into components
	time = time.toString ().match (/^([01]\d|2[0-3])([0-5]\d)$/) || [time];

	if (time.length > 1) { // If time format correct
		const suffix = time[1] < 12 ? 'AM' : 'PM'; // Set AM/PM
		const hours = time[1] % 12 || 12; // Adjust hours
		const minutes = time[2];

		return `${hours}:${minutes}${suffix}`;
	}
	return time;
}

export default tConvert;
