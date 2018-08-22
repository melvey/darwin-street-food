
const days = {
	'Sunday': 'Sun',
	'Monday': 'Mon',
	'Tuesday': 'Tues',
	'Wednesday': 'Wed',
	'Thursday': 'Thurs',
	'Friday': 'Fri',
	'Saturday': 'Sat'
}


function tidyList(listData) {
	return listData.filter((record, index) => listData.findIndex((findRecord) => findRecord.Name === record.Name) === index)
		.map((record) => ({
			name: record.Name,
			website: record.Website,
			type: record.Type,
			locations: listData.filter((locationRecord) => locationRecord.Name === record.Name)
				.map((locationRecord) => ({
					name: locationRecord.Location,
					openTimes: locationRecord.Open_Times_Description,
					days: Object.keys(days)
						.map((day) => ({
							day,
							open: record[day] === 'Yes',
							start: record[`${days[day]}_Start`],
							end: record[`${days[day]}_End`]
						}))
				}))
		}));
}

export default tidyList;
