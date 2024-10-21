let {
    getModels
} = require('../../database/mysql');
let path = require('path');
let ejs = require("ejs");
const puppeteer = require('puppeteer')
const hb = require('handlebars')
let mysql = require('../../database/mysql');
let {
    sendMail,
    QuaryMysql,
    QuaryMysqlReplace,
    findRecordinMongo,
    getCustomLogo
} = require('../../Utils/Utils');
const {
    Op
} = require('sequelize');
let json2csv = require('json2csv');
let fs = require('fs');


async function timeregion(times, cb) {
    return new Promise((reslove) => {
        var arr = times.split(":");
        var hours = parseInt(arr[0]) * 60;
        var min = parseInt(arr[1]);
        var milisec = 0;
        if (hours >= 0) {
            milisec = (hours + min) * 60000
        } else {
            milisec = (hours - min) * 60000
        }
        if (arr[0] == "-00") {
            reslove('' + (0 - milisec));
        } else {
            reslove('' + milisec);
        }
    })

}
module.exports = {
    report: async (req, res) => {
        if (req.query.report_type && req.query.report_type === 'booking') {
            try {
                let bookings = await BookingReport(req.query.booking_id);
                if (bookings.length > 0) {
                    let {
                        location,
                        floor,
                        room,
                        desk,
                        region_time,
                        desk_id,
                        ...rest
                    } = bookings[0];
                    if (rest.state == 3) {
                        let timesec = await timeregion(region_time);
                        let start = (parseInt('' + rest.start) + parseInt(timesec));
                        let end = (parseInt('' + rest.end) + parseInt(timesec));
                        let {
                            statement,
                            time
                        } = await BookingHeading(start, end, false);
                        let period = ['12 AM - 01 AM', '01 AM - 02 AM', '02 AM - 03 AM', '03 AM - 04 AM', '04 AM - 05 AM', '05 AM - 06 AM', '06 AM - 07 AM', '07 AM - 08 AM', '08 AM - 09 AM', '09 AM - 10 AM', '10 AM - 11 AM', '11 AM - 12 PM', '12 PM - 01 PM', '01 PM - 02 PM', '02 PM - 03 PM', '03 PM - 04 PM', '04 PM - 05 PM', '05 PM - 06 PM', '06 PM - 07 PM', '07 PM - 08 PM', '08 PM - 09 PM', '09 PM - 10 PM', '10 PM - 11 PM', '11 PM - 12 PM'];
                        let energygraph = new Array(24).fill(0);
                        let occgraph = new Array(24).fill(0);
                        let [bookstate, bookhistory] = await findRecordinMongo('booking_history', {
                            uuid: req.query.booking_id,
                            state: {
                                $in: [1, 2, 3]
                            }
                        }, {
                            _id: 0,
                            state: 1,
                            ts: 1
                        }, {
                            ts: 1
                        }, 0);
                        let books = {
                            inuse: 0,
                            inmeeting: 0
                        }
                        if (bookstate) {
                            console.log(bookhistory);
                            bookhistory.forEach((ele, index) => {
                                if (index > 0) {
                                    let old = bookhistory[index - 1];
                                    if ((ele.state == 3 || ele.state == 2 || ele.state==1) && old.state == 1) {
                                        books.inuse += (((ele.ts) - (old.ts)) / 1000)
                                    }
                                    if ((ele.state == 1 || ele.state == 2 || ele.state == 3) && old.state == 2) {
                                        books.inmeeting += (((ele.ts) - (old.ts)) / 1000)
                                    }
                                }
                            })
                        } else {
                            books.inuse = (end - start)/1000 ;
                            books.inmeeting = 0
                        }
                        books.inuse = secondsToHrMinSec(books.inuse);
                        books.inmeeting = secondsToHrMinSec(books.inmeeting);
                        let records = await getOccpanctState(desk_id, start, end);
                        let occgr = records.reduce((prv, curr, index) => {
                            let ts = new Date(curr.ts);
                            ts.setUTCMinutes(0, 0, 0);
                            let last = prv.graph[`${ts.getTime()}`]
                            let std = prv.std[`${ts.getTime()}`]
                            let sit = prv.sit[`${ts.getTime()}`]
                            if (last == undefined) {
                                last = 0;
                            }
                            if (std == undefined) {
                                std = 0
                            }
                            if (sit == undefined) {
                                sit = 0
                            }
                            if (index > 0) {
                                let olddata = records[index - 1];
                                if ((olddata.state == 1) && (curr.state == 1 || curr.state == 0)) {
                                    let sec = parseInt((curr.ts - olddata.ts) / 1000);
                                    last += sec
                                    if (olddata.distance > 90) {
                                        std += sec
                                    } else {
                                        sit += sec
                                    }
                                }
    
                            }
                            prv.graph[`${ts.getTime()}`] = last;
                            prv.sit[`${ts.getTime()}`] = sit;
                            prv.std[`${ts.getTime()}`] = std;
                            return prv;
                        }, {
                            graph: {},
                            sit: {},
                            std: {}
                        })
                        let occavg = 0
                        let daily = {};
                        let listenergy = [];
                        let lastsitt = 0;
                        let laststd = 0;
                        let enrgylast = 0;
                        let totalenergy = 0
                        let sitting = {
                            sit: 0,
                            std: 0,
                            energy: 0
                        }
                        Object.keys(occgr.graph).forEach(ele => {
                            let hours = new Date(parseInt(ele));
                            let per = parseFloat(((occgr.graph[`${ele}`] / 3600) * 100).toFixed(2))
                            let total = occgr.sit[`${ele}`] + occgr.std[`${ele}`]
                            let sitper = parseFloat(((occgr.sit[`${ele}`] / total) * 100).toFixed(2))
                            let stdper = parseFloat(((occgr.std[`${ele}`] / total) * 100).toFixed(2))
                            occgraph[hours.getUTCHours()] = per;
                            if (occgr.sit[`${ele}`] > lastsitt) {
                                lastsitt = occgr.sit[`${ele}`];
                                sitting.sit = `${secondsToHrMinSec(lastsitt)}, ${period[hours.getUTCHours()]}`
                            }
                            if (occgr.std[`${ele}`] > laststd) {
                                laststd = occgr.std[`${ele}`];
                                sitting.std = `${secondsToHrMinSec(laststd)}, ${period[hours.getUTCHours()]}`
                            }
                            daily[ele] = {
                                occ: per,
                                sit: sitper,
                                std: stdper,
                                energy: 0,
                                date: period[hours.getUTCHours()]
                            }
                            occavg += occgr.graph[`${ele}`];
                        })
                        if (occavg > 0) {
                            occavg = parseFloat(((occavg / ((end - start) / 1000)) * 100).toFixed(2))
                            if (occavg > 100) {
                                occavg = 100;
                            }
                        }
                        let [energystate, energyrecords] = await findRecordinMongo('desk_energy_hours', {
                            desk_id: desk_id,
                            ts: {
                                $gte: start,
                                $lte: end
                            }
                        }, {
                            _id: 0,
                            Pt: 1,
                            ts: 1
                        }, {
                            ts: 1
                        }, 0);
                        if (energyrecords.length > 0) {
                            let energygrp = energyrecords.reduce((prv, cur) => {
                                let ts = new Date(cur.ts);
                                ts.setUTCMinutes(0, 0, 0);
                                let enerts = prv[`${ts.getTime()}`];
                                let sum = (cur.Pt).reduce((pr, cu) => prv + cu);
                                if (enerts == undefined) {
                                    enerts = 0
                                }
                                enerts += sum;
                                prv[`${ts.getTime()}`] = enerts;
                                return prv;
                            }, {})
                            Object.keys(energygrp).forEach(ele => {
                                let hours = new Date(parseInt(ele));
                                let data = daily[ele];
                                let pt = (energygrp[ele]) / 1000;
                                totalenergy += pt
                                if (pt > enrgylast) {
                                    enrgylast = pt;
                                    sitting.energy = `${pt.toFixed(3)} kWh, ${period[hours.getUTCHours()]}`
                                }
                                energygraph[hours.getUTCHours()] = pt;
                                if (data == undefined) {
                                    data = {
                                        occ: 0,
                                        sit: 0,
                                        std: 0,
                                        energy: pt.toFixed(3),
                                        date: period[hours.getUTCHours()]
                                    }
                                } else {
                                    data.energy = pt.toFixed(3);
                                }
                                listenergy.push(data);
                            })
    
                        }
                        let obj = {
                            type: "",
                            statement: statement,
                            loc_info: {
                                locname: location,
                                floor: floor,
                                area: room,
                                desk_name: desk,
                                time: time
                            },
                            occavg: occavg,
                            sitting: sitting.sit,
                            standing: sitting.std,
                            inuse: books.inuse,
                            inmeeting: books.inmeeting,
                            tenergy: totalenergy.toFixed(3),
                            peakenergy: sitting.energy,
                            daily: listenergy,
                            category: period.toString(),
                            energy: energygraph.toString(),
                            occpancy: occgraph.toString()
                        }
                        obj.logo= await getCustomLogo(req.headers.companyId)
                        let paths = await PDFGenerate('booking-template', `Booking_${req.query.booking_id}`, obj);
                        if (paths[0]) {
                            res.status(200).download(paths[1]);
                        } else {
                            res.send({
                                status: 0,
                                message: "Something wnet wrong, Please try again later."
                            });
                        }
                    } else {
                        res.send({
                            status: 0,
                            message: "Something wnet wrong, Please try again later."
                        });
                    }
                } else {
                    res.send({
                        status: 0,
                        message: "no report information"
                    });
                }
            } catch(err) {
                console.log(err);
                res.send({status: 0, message: err.message});
            }
        } else if (req.query.report_type && req.query.report_type === 'locationsss') {
            if (req.query.start && req.query.end) {
                let obj = {};
                obj.energy_type = true;
                obj.occ_type = true;
                if (req.query.energy && req.query.energy == 'false') {
                    obj.energy_type = false;
                }
                if (req.query.average && req.query.average == 'false') {
                    obj.occ_type = false;
                }
                obj.loc_type = true;
                obj.type = req.query.type || 'Custom';
                obj.tdesks = 0;
                obj.energytotal = 0;
                obj.avgocctotal = 0;
                obj.occtotal = 0;
                let created_date = new Date(parseInt(req.query.end)).toISOString();
                let locations = await getModels().SuperLocations.findOne({
                    where: {
                        loc_id: req.query.loc_id,
                        created_date: {
                            [Op.lte]: created_date
                        }
                    },
                    attributes: ['location_name']
                });
                if (locations) {
                    obj.location_name = locations.location_name;
                    let quary = `Select location_id,location_name,(select count(*) from device_desks as dd join location_rooms as lr on lr.room_id=dd.room_id where lr.location_id=ld.location_id and dd.is_active=true and dd.created_at < '${created_date}') as desks from locations_details as ld where ld.loc_id='${req.query.loc_id}' and ld.created_date < '${created_date}' and  ld.is_active=true`;
                    let floors = await QuaryMysql(quary);
                    if (floors.length > 0) {
                        let floor_name = floors.reduce((curr, prev) => {
                            curr[`${prev.location_id}`] = `${prev.location_name} (${prev.desks} desks)`;
                            curr[`name_${prev.location_id}`] = `${prev.location_name}`;
                            obj.tdesks += prev.desks;
                            return curr;
                        }, {})
                        let loc_ids = floors.map(ele => {
                            return ele.location_id
                        });
                        let roomquary = `select room_id,location_id from location_rooms where is_default=false and is_active=true and location_id IN(:locId) `
                        let rooms = await QuaryMysqlReplace(roomquary, {
                            locId: loc_ids
                        });
                        if (rooms.length > 0) {
                            let roomsid = []
                            let room = rooms.reduce((prev, curr) => {
                                roomsid.push(curr.room_id);
                                prev[`${curr.room_id}`] = `${curr.location_id}`;
                                return prev;
                            }, {})
                            let quary = {
                                room_id: {
                                    $in: roomsid
                                },
                                ts: {
                                    $gte: parseInt(req.query.start),
                                    $lt: parseInt(req.query.end)
                                }
                            };

                            let [energystate, energy, roomenergy] = await getDeskEnergy(roomsid, parseInt(req.query.start), parseInt(req.query.end), obj.energy_type);
                            let reports = {};
                            let areareprot = {};
                            if (energystate && Object.keys(energy).length > 0) {
                                areareprot = Object.keys(roomenergy).reduce((perv, curr) => {
                                    let data = perv[`${curr}`];
                                    if (data == undefined) {
                                        data = {
                                            energy: 0,
                                            occ: 0
                                        }
                                    }
                                    data.energy += roomenergy[`${curr}`];
                                    data.energy = parseFloat((data.energy).toFixed(3))
                                    perv[`${curr}`] = data
                                    return perv;
                                }, {})
                                reports = Object.keys(energy).reduce((perv, curr) => {
                                    let data = perv[`${curr}`];
                                    if (data == undefined) {
                                        data = {
                                            sit: 0,
                                            std: 0,
                                            energy: 0,
                                            occ: 0,
                                            ts: curr
                                        }
                                    }
                                    data.energy += energy[`${curr}`];
                                    data.energy = parseFloat((data.energy).toFixed(3));
                                    obj.energytotal += energy[`${curr}`];
                                    obj.energytotal = parseFloat((obj.energytotal).toFixed(3));
                                    perv[`${curr}`] = data
                                    return perv;
                                }, {})
                            }
                            let [occstate, occdata, roomoccdata] = await getDeskOccpancy(quary, obj.occ_type);
                            if (occstate && Object.keys(occdata).length > 0) {
                                Object.keys(roomoccdata).forEach((ele) => {
                                    let data = areareprot[`${ele}`];
                                    if (data == undefined) {
                                        data = roomoccdata[`${ele}`];
                                    } else {
                                        let occ = roomoccdata[`${ele}`];
                                        data.occ = occ.occ;
                                    }
                                    areareprot[`${ele}`] = data;
                                })
                                Object.keys(occdata).forEach((ele) => {
                                    let data = reports[`${ele}`];
                                    if (data == undefined) {
                                        data = occdata[`${ele}`];
                                    } else {
                                        let occ = occdata[`${ele}`];
                                        data.sit = occ.sit;
                                        data.std = occ.std;
                                        data.occ = occ.occ;
                                    }
                                    reports[`${ele}`] = data;
                                    obj.occtotal += data.occ
                                })
                                obj.avgocctotal = parseFloat(((obj.occtotal / ((Object.keys(occdata).length) * 100)) * 100).toFixed(2));
                            }
                            obj.categorys = [];
                            obj.energy = [];
                            obj.occpancy = [];
                            obj.days = (Object.keys(reports).sort((a,b)=>a-b)).reduce((prv, curr) => {
                                let date = (new Date(parseInt(curr)).toUTCString()).split(' ');
                                let datas = reports[curr];
                                datas.date = `${date[1]} ${date[2]} ${date[3]} ${date[0].replace(/,/g,'')}`
                                datas.cdate = `${date[2]} ${date[1]} ${date[0].replace(/,/g,'')}`
                                obj.categorys.push(datas.cdate);
                                obj.energy.push(datas.energy);
                                obj.occpancy.push(datas.occ);
                                prv.push(datas);
                                return prv;
                            }, []);
                            let area = Object.keys(room).reduce((prv, curr) => {
                                let loc_id = room[curr]
                                let occdata = areareprot[curr];
                                let arrdata = prv[loc_id];
                                if (arrdata == undefined && occdata !== undefined) {
                                    arrdata = occdata;
                                    arrdata.name = floor_name[loc_id];
                                    arrdata.count = 1
                                    if(arrdata.occ>0){
                                        arrdata.occ=parseFloat((arrdata.occ).toFixed(2));
                                    }
                                    if(arrdata.energy>0){
                                        arrdata.energy=parseFloat((arrdata.energy).toFixed(3));
                                    }
                                    prv[loc_id] = arrdata;
                                } else if (arrdata != undefined && occdata !== undefined) {
                                    arrdata.occ += occdata.occ;
                                    arrdata.energy += occdata.energy;
                                    arrdata.count += 1
                                    if(arrdata.occ>0){
                                        arrdata.occ=parseFloat((arrdata.occ).toFixed(2));
                                    }
                                    if(arrdata.energy>0){
                                        arrdata.energy=parseFloat((arrdata.energy).toFixed(3));
                                    }
                                    prv[loc_id] = arrdata;
                                }
                               
                                return prv
                            }, {})
                            let paiocc = [];
                            let paienergy = [];
                            obj.areas = Object.keys(area).reduce((prv, curr) => {
                                let cudata = area[curr];
                                let count = cudata.count;
                                cudata.occ = parseFloat((cudata.occ / count).toFixed(2));
                                delete cudata.count;
                                prv.push(cudata);
                                let occdata = {}
                                occdata.y = cudata.occ;
                                occdata.name = floor_name[`name_${curr}`];
                                paiocc.push(occdata)
                                let energydata = {}
                                energydata.y = cudata.energy;
                                energydata.name = floor_name[`name_${curr}`];
                                paienergy.push(energydata)
                                return prv;
                            }, [])
                            obj.areas=obj.areas.sort(function (a, b) {
                                if (a.name < b.name) {
                                  return -1;
                                }
                                if (a.name > b.name) {
                                  return 1;
                                }
                                return 0;
                              });
                            let occtotal = (paiocc).reduce((prv, cur) => {
                                prv += cur.y
                                return prv;
                            }, 0);
                            let enrgytotal = (paienergy).reduce((prv, cur) => {
                                prv += cur.y
                                return prv;
                            }, 0);
                            obj.paiocc = paiocc.reduce((prv, curr) => {
                                curr.y = parseFloat(((curr.y / occtotal) * 100).toFixed(2));
                                prv.push(curr);
                                return prv
                            }, []);
                            obj.paiocc = JSON.stringify(obj.paiocc);
                            obj.paienergy = paienergy.reduce((prv, curr) => {
                                curr.y = parseFloat(((curr.y / enrgytotal) * 100).toFixed(2));
                                prv.push(curr);
                                return prv
                            }, []);
                            obj.paienergy = JSON.stringify(obj.paienergy);
                            let start = (new Date(parseInt(obj.days[0].ts)).toUTCString()).split(' ')
                            let end = (new Date(parseInt(obj.days[(obj.days).length - 1].ts)).toUTCString()).split(' ')
                            obj.periods = `${start[2]} ${start[1]} ${start[3]} - ${end[2]} ${end[1]} ${end[3]}`
                            let userinfo = await QuaryMysql(`select ud.name,ud.email_id,ud.companyId,ud.user_type from user_details as ud join super_locations_details as sld on sld.user_id=ud.user_id where sld.loc_id='${req.query.loc_id}'`)
                            let comp_id=undefined
                            if(userinfo.length>0){
                                comp_id=userinfo[0].companyId;
                            }
                            obj.logo=await getCustomLogo(comp_id)
                            if (energystate || occstate) {
                                if (req.query.csv) {
                                    const energy_fields = [
                                        { label: 'Date', value: 'date' },
                                        { label: 'Average Occupancy(%)', value: 'occ' },
                                        { label: 'Sitting(%)', value: 'sit' },
                                        { label: 'Standing(%)', value: 'std' },
                                        { label: 'Energy Consumed(kWh)', value: 'energy' }
                                    ];
                                    const area_fields = [
                                        { label: 'Floor', value: 'name' },
                                        { label: 'Average Occupancy(%)', value: 'occ' },
                                        { label: 'Energy Consumed(kWh)', value: 'energy' }
                                    ];
                                    const csv_energy = json2csv.parse(obj.days, { fields: energy_fields });
                                    const csv_area = json2csv.parse(obj.areas, { fields: area_fields });
                                    const csv = `${csv_energy}\n\n${csv_area}`;
                                    res.setHeader('Content-Type', 'text/csv');
                                    res.setHeader('Content-Disposition', `attachment; filename="${obj.type}_${req.query.location_id}_${new Date().getTime()}.csv"`);
                                    return res.status(200).send(csv);
                                }
                                let paths = await PDFGenerate('location-template', `${obj.type}_${req.query.loc_id}_${new Date().getTime()}`, obj);
                                if (req.query && req.query.email === 'true') {
                                    
                                    if (userinfo.length > 0 && paths[0]) {
                                        let filename = `${req.query.type}_location_${new Date().getTime()}`
                                        let maildata = JSON.parse(JSON.stringify(userinfo[0]))
                                        maildata.statement = `${req.query.type} statement`
                                        maildata.dates = `${new Date(parseInt(req.query.start)).toDateString()}-${new Date(parseInt(req.query.end)).toDateString()}`
                                        maildata.location = locations.location_name;
                                        maildata.subject = `${req.query.type} statement from ${maildata.dates} of Your Occpancy Dashboard location ${locations.location_name}`;
                                        maildata.attachments = [{ // utf-8 string as an attachment
                                            filename: `${filename}.pdf`,
                                            path: paths[1]
                                        }]
                                        sendMail(maildata, maildata.companyId, 1);
                                        res.send({
                                            status: 1,
                                            message: "Mail send successfully"
                                        });
                                    } else {
                                        res.send({
                                            status: 0,
                                            message: "Details not found"
                                        });
                                    }
                                } else {
                                    if (paths[0]) {
                                        res.status(200).download(paths[1]);
                                    } else {
                                        res.send({
                                            status: 0,
                                            message: "Invalid information"
                                        });
                                    }
                                }
                            } else {
                                res.send({
                                    status: 0,
                                    message: "no floors found"
                                });
                            }
                        } else {
                            res.send({
                                status: 0,
                                message: "no location found"
                            });
                        }

                    } else {
                        res.send({
                            status: 0,
                            message: "no location found"
                        });
                    }

                } else {
                    res.send({
                        status: 0,
                        message: "Invalid information"
                    });
                }

            } else {
                res.send({
                    status: 0,
                    message: "Invalid information"
                });
            }
        } else if (req.query.report_type && req.query.report_type === 'floorsss') {
            if (req.query.start && req.query.end) {
                let obj = {};
                obj.energy_type = true;
                obj.occ_type = true;
                if (req.query.energy && req.query.energy == 'false') {
                    obj.energy_type = false;
                }
                if (req.query.average && req.query.average == 'false') {
                    obj.occ_type = false;
                }
                obj.loc_type = false;
                obj.type = req.query.type || 'Custom';
                obj.tdesks = 0;
                obj.energytotal = 0;
                obj.avgocctotal = 0;
                obj.occtotal = 0;
                let created_date = new Date(parseInt(req.query.end)).toISOString();
                let locations = await QuaryMysql(`select sld.location_name,ld.location_name as floorname from super_locations_details as sld join locations_details as ld on ld.loc_id=sld.loc_id where ld.is_active=true and ld.location_id ='${req.query.location_id}' and ld.created_date < '${created_date}'`);
                if (locations.length > 0) {
                    obj.location_name = locations[0].location_name;
                    obj.floorname = locations[0].floorname;
                    let room = await QuaryMysql(`select room_id,room_name,(select count(*) from device_desks as dd where dd.room_id=lr.room_id and dd.is_active=true and dd.created_at < '${created_date}') as desks from location_rooms as lr where lr.location_id='${req.query.location_id}' and lr.created_at < '${created_date}' and  lr.is_active=true`);
                    if (room.length > 0) {
                        let room_name = room.reduce((curr, prev) => {
                            curr[`${prev.room_id}`] = `${prev.room_name} (${prev.desks} desks)`;
                            curr[`name_${prev.room_id}`] = `${prev.room_name}`;
                            obj.tdesks += prev.desks;
                            return curr;
                        }, {})
                        let room_ids = room.map(ele => {
                            return ele.room_id
                        });
                        let quary = {
                            room_id: {
                                $in: room_ids
                            },
                            ts: {
                                $gte: parseInt(req.query.start),
                                $lt: parseInt(req.query.end)
                            }
                        };
                        let [energystate, energy, roomenergy] = await getDeskEnergy(room_ids, parseInt(req.query.start), parseInt(req.query.end), obj.energy_type);
                        let reports = {};
                        let areareprot = {};
                        if (energystate && Object.keys(energy).length > 0) {
                            areareprot = Object.keys(roomenergy).reduce((perv, curr) => {
                                let data = perv[`${curr}`];
                                if (data == undefined) {
                                    data = {
                                        energy: 0,
                                        occ: 0
                                    }
                                }
                                data.energy += roomenergy[`${curr}`];
                                data.energy = (parseFloat((data.energy).toFixed(3)))
                                perv[`${curr}`] = data
                                return perv;
                            }, {})
                            reports = Object.keys(energy).reduce((perv, curr) => {
                                let data = perv[`${curr}`];
                                if (data == undefined) {
                                    data = {
                                        sit: 0,
                                        std: 0,
                                        energy: 0,
                                        occ: 0,
                                        ts: curr
                                    }
                                }
                                data.energy += energy[`${curr}`];
                                data.energy = (parseFloat((data.energy).toFixed(3)))
                                obj.energytotal += energy[`${curr}`];
                                obj.energytotal = (parseFloat((obj.energytotal).toFixed(3)))
                                perv[`${curr}`] = data
                                return perv;
                            }, {})
                        }
                        let [occstate, occdata, roomoccdata] = await getDeskOccpancy(quary, obj.occ_type);
                        if (occstate && Object.keys(occdata).length > 0) {
                            Object.keys(roomoccdata).forEach((ele) => {
                                let data = areareprot[`${ele}`];
                                if (data == undefined) {
                                    data = roomoccdata[`${ele}`];
                                } else {
                                    let occ = roomoccdata[`${ele}`];
                                    data.occ = occ.occ;
                                }
                                areareprot[`${ele}`] = data;
                            })
                            Object.keys(occdata).forEach((ele) => {
                                let data = reports[`${ele}`];
                                if (data == undefined) {
                                    data = occdata[`${ele}`];
                                } else {
                                    let occ = occdata[`${ele}`];
                                    data.sit = parseInt(occ.sit).toFixed(0);
                                    data.std = parseInt(occ.std).toFixed(0);
                                    data.occ = occ.occ;
                                }
                                reports[`${ele}`] = data;
                                obj.occtotal += data.occ
                            })
                            obj.avgocctotal = parseFloat(((obj.occtotal / ((Object.keys(occdata).length) * 100)) * 100).toFixed(2));
                        }
                        obj.categorys = [];
                        obj.energy = [];
                        obj.occpancy = [];
                        obj.days = (Object.keys(reports).sort((a,b)=>a-b)).reduce((prv, curr) => {
                            let date = (new Date(parseInt(curr)).toUTCString()).split(' ');
                            let datas = reports[curr];
                            datas.ts=curr;
                            datas.date = `${date[1]} ${date[2]} ${date[3]} ${date[0].replace(/,/g,'')}`
                            datas.cdate = `${date[2]} ${date[1]} ${date[0].replace(/,/g,'')}`
                            obj.categorys.push(datas.cdate);
                            obj.energy.push(datas.energy);
                            obj.occpancy.push(datas.occ);
                            prv.push(datas);
                            return prv;
                        }, []);
                        let paiocc = [];
                        let paienergy = [];
                        obj.areas = Object.keys(areareprot).reduce((prv, curr) => {
                            let cudata = areareprot[curr];
                            cudata.name = room_name[`${curr}`];
                            prv.push(cudata);
                            let occdata = {}
                            occdata.y = cudata.occ;
                            occdata.name = room_name[`name_${curr}`];
                            paiocc.push(occdata)
                            let energydata = {}
                            energydata.y = cudata.energy;
                            energydata.name = room_name[`name_${curr}`];
                            paienergy.push(energydata)
                            return prv;
                        }, [])
                        obj.areas=obj.areas.sort(function (a, b) {
                            if (a.name < b.name) {
                              return -1;
                            }
                            if (a.name > b.name) {
                              return 1;
                            }
                            return 0;
                          });
                        let occtotal = (paiocc).reduce((prv, cur) => {
                            prv += cur.y
                            return prv;
                        }, 0);
                        let enrgytotal = (paienergy).reduce((prv, cur) => {
                            prv += cur.y
                            return prv;
                        }, 0);
                        obj.paiocc = paiocc.reduce((prv, curr) => {
                            curr.y = parseFloat(((curr.y / occtotal) * 100).toFixed(2));
                            prv.push(curr);
                            return prv
                        }, []);
                        obj.paiocc = JSON.stringify(obj.paiocc);
                        obj.paienergy = paienergy.reduce((prv, curr) => {
                            curr.y = parseFloat(((curr.y / enrgytotal) * 100).toFixed(2));
                            prv.push(curr);
                            return prv
                        }, []);
                        obj.paienergy = JSON.stringify(obj.paienergy);
                        if(obj.days!=undefined && (obj.days).length>0){
                            let start = (new Date(parseInt(obj.days[0].ts)).toUTCString()).split(' ')
                            let end = (new Date(parseInt(obj.days[(obj.days).length - 1].ts)).toUTCString()).split(' ')
                            obj.periods = `${start[2]} ${start[1]} ${start[3]} - ${end[2]} ${end[1]} ${end[3]}`
                            obj.logo= await getCustomLogo(req.headers.companyId)
                            if (req.query.csv) {
                                const energy_fields = [
                                    { label: 'Date', value: 'date' },
                                    { label: 'Average Occupancy(%)', value: 'occ' },
                                    { label: 'Sitting(%)', value: 'sit' },
                                    { label: 'Standing(%)', value: 'std' },
                                    { label: 'Energy Consumed(kWh)', value: 'energy' }
                                ];
                                const area_fields = [
                                    { label: 'Floor', value: 'name' },
                                    { label: 'Average Occupancy(%)', value: 'occ' },
                                    { label: 'Energy Consumed(kWh)', value: 'energy' }
                                ];
                                const csv_energy = json2csv.parse(obj.days, { fields: energy_fields });
                                const csv_area = json2csv.parse(obj.areas, { fields: area_fields });
                                const csv = `${csv_energy}\n\n${csv_area}`;
                                res.setHeader('Content-Type', 'text/csv');
                                res.setHeader('Content-Disposition', `attachment; filename="${obj.type}_${req.query.location_id}_${new Date().getTime()}.csv"`);
                                return res.status(200).send(csv);
                            }
                            else {
                                let paths = await PDFGenerate('location-template', `${obj.type}_${req.query.location_id}_${new Date().getTime()}`, obj);
                                paths[0] ? res.status(200).download(paths[1]) : res.send({ status: 0, message: "Invalid information" });
                            }   
                        }else {
                            res.send({
                                status: 0,
                                message: "report not found"
                            });
                        }
                        



                    } else {
                        res.send({
                            status: 0,
                            message: "no floors found"
                        });
                    }
                } else {
                    res.send({
                        status: 0,
                        message: "no location found"
                    });
                }
            } else {
                res.send({
                    status: 0,
                    message: "Invalid information"
                });
            }
        } else if (req.query.report_type && req.query.report_type === 'daily') {
            let bookings = await BookingDayReport(req.headers.user_id, req.query.from, req.query.to);
            if (bookings.length > 0) {
                let timesec = await timeregion(bookings[0].region_time);
                let start = (parseInt('' + req.query.from) + parseInt(timesec));
                let end = (parseInt('' + req.query.to) + parseInt(timesec));
                let {
                    statement,
                    time
                } = await BookingHeading(start, end, false);
                let period = ['12 AM - 01 AM', '01 AM - 02 AM', '02 AM - 03 AM', '03 AM - 04 AM', '04 AM - 05 AM', '05 AM - 06 AM', '06 AM - 07 AM', '07 AM - 08 AM', '08 AM - 09 AM', '09 AM - 10 AM', '10 AM - 11 AM', '11 AM - 12 PM', '12 PM - 01 PM', '01 PM - 02 PM', '02 PM - 03 PM', '03 PM - 04 PM', '04 PM - 05 PM', '05 PM - 06 PM', '06 PM - 07 PM', '07 PM - 08 PM', '08 PM - 09 PM', '09 PM - 10 PM', '10 PM - 11 PM', '11 PM - 12 PM'];
                let energygraph = new Array(24).fill(0);
                let occgraph = new Array(24).fill(0);
                let totalbooking = 0
                let PromArr = [];
                let EnergyArr = [];
                let location = [];
                let floor = [];
                let room = [];
                let desk = []
                let book_ids = bookings.map((ele) => {
                    if (!location.includes(ele.location)) {
                        location.push(ele.location)
                    }
                    if (!floor.includes(ele.floor)) {
                        floor.push(ele.floor)
                    }
                    if (!room.includes(ele.room)) {
                        room.push(ele.room)
                    }
                    if (!desk.includes(ele.desk)) {
                        desk.push(ele.desk)
                    }
                    let start = (parseInt('' + ele.start) + parseInt(timesec));
                    let end = (parseInt('' + ele.end) + parseInt(timesec));
                    PromArr.push(getOccpanctState(ele.desk_id, start, end));
                    EnergyArr.push(getEnergyData(ele.desk_id, start, end));
                    totalbooking += (ele.end - ele.start);
                    return ele.uuid
                })
                location = location.join(",");
                floor = floor.join(",");
                room = room.join(",");
                desk = desk.join(",");
                let [bookstate, bookhistory] = await findRecordinMongo('booking_history', {
                    uuid: {
                        $in: book_ids
                    },
                    state: {
                        $in: [1, 2, 3]
                    }
                }, {
                    _id: 0,
                    state: 1,
                    ts: 1
                }, {
                    ts: 1
                }, 0);
                let books = {
                    inuse: 0,
                    inmeeting: 0
                };
                if (bookstate) {
                    bookhistory.forEach((ele, index) => {
                        if (index > 0) {
                            let old = bookhistory[index - 1];
                            if ((ele.state == 3 || ele.state == 1 || ele.state == 2) && old.state == 1) {
                                books.inuse += (((ele.ts) - (old.ts)) / 1000)
                            }
                            if ((ele.state == 1 ||ele.state == 2 || ele.state == 3) && old.state == 2) {
                                books.inmeeting += (((ele.ts) - (old.ts)) / 1000)
                            }
                        }
                    })
                } else {
                    bookings.forEach((ele) => {
                        books.inuse += (ele.end - ele.start) / 1000;
                        books.inmeeting = 0
                    });
                }
                books.inuse = secondsToHrMinSec(books.inuse);
                books.inmeeting = secondsToHrMinSec(books.inmeeting);
                let record = await PromCallApi(PromArr)
                let energyrecords = await PromCallApi(EnergyArr);
                let records = record.sort((a, b) => a.ts - b.ts);
                let occgr = records.reduce((prv, curr, index) => {
                    let ts = new Date(curr.ts);
                    ts.setUTCMinutes(0, 0, 0);
                    let last = prv.graph[`${ts.getTime()}`]
                    let std = prv.std[`${ts.getTime()}`]
                    let sit = prv.sit[`${ts.getTime()}`]
                    if (last == undefined) {
                        last = 0;
                    }
                    if (std == undefined) {
                        std = 0
                    }
                    if (sit == undefined) {
                        sit = 0
                    }
                    if (index > 0) {
                        let olddata = records[index - 1];
                        if ((olddata.state == 1) && (curr.state == 1 || curr.state == 0)) {
                            let sec = parseInt((curr.ts - olddata.ts) / 1000);
                            last += sec
                            if (olddata.distance > 90) {
                                std += sec
                            } else {
                                sit += sec
                            }
                        }

                    }
                    prv.graph[`${ts.getTime()}`] = last;
                    prv.sit[`${ts.getTime()}`] = sit;
                    prv.std[`${ts.getTime()}`] = std;
                    return prv;
                }, {
                    graph: {},
                    sit: {},
                    std: {}
                })
                let occavg = 0
                let daily = {};
                let listenergy = [];
                let lastsitt = 0;
                let laststd = 0;
                let enrgylast = 0;
                let totalenergy = 0
                let sitting = {
                    sit: 0,
                    std: 0,
                    energy: 0
                }
                Object.keys(occgr.graph).forEach(ele => {
                    let hours = new Date(parseInt(ele));
                    let per = parseFloat(((occgr.graph[`${ele}`] / 3600) * 100).toFixed(2))
                    if (per > 100) {
                        per = 100;
                    }
                    let total = occgr.sit[`${ele}`] + occgr.std[`${ele}`]
                    let sitper = parseFloat(((occgr.sit[`${ele}`] / total) * 100).toFixed(2))
                    let stdper = parseFloat(((occgr.std[`${ele}`] / total) * 100).toFixed(2))
                    occgraph[hours.getUTCHours()] = per;
                    if (occgr.sit[`${ele}`] > lastsitt) {
                        lastsitt = occgr.sit[`${ele}`];
                        sitting.sit = `${secondsToHrMinSec(lastsitt)}, ${period[hours.getUTCHours()]}`
                    }
                    if (occgr.std[`${ele}`] > laststd) {
                        laststd = occgr.std[`${ele}`];
                        sitting.std = `${secondsToHrMinSec(laststd)}, ${period[hours.getUTCHours()]}`
                    }
                    daily[ele] = {
                        occ: per,
                        sit: sitper,
                        std: stdper,
                        energy: 0,
                        date: period[hours.getUTCHours()]
                    }
                    occavg += occgr.graph[`${ele}`];
                })
                if (occavg > 0) {
                    occavg = parseFloat(((occavg / (totalbooking / 1000)) * 100).toFixed(2))
                    if (occavg > 100) {
                        occavg = 100;
                    }
                }
                if (energyrecords.length > 0) {
                    let energygrp = energyrecords.reduce((prv, cur) => {
                        let ts = new Date(cur.ts);
                        ts.setUTCMinutes(0, 0, 0);
                        let enerts = prv[`${ts.getTime()}`];
                        let sum = (cur.Pt).reduce((pr, cu) => pr + cu);
                        if (enerts == undefined) {
                            enerts = 0
                        }
                        enerts += sum;
                        prv[`${ts.getTime()}`] = enerts;
                        return prv;
                    }, {})
                    Object.keys(energygrp).forEach(ele => {
                        let hours = new Date(parseInt(ele));
                        let data = daily[ele];
                        let pt = (energygrp[ele]) / 1000;
                        totalenergy += pt
                        if (pt > enrgylast) {
                            enrgylast = pt;
                            sitting.energy = `${pt.toFixed(3)} kWh, ${period[hours.getUTCHours()]}`
                        }
                        energygraph[hours.getUTCHours()] = pt;
                        if (data == undefined) {
                            data = {
                                occ: 0,
                                sit: 0,
                                std: 0,
                                energy: pt.toFixed(3),
                                date: period[hours.getUTCHours()]
                            }
                        } else {
                            data.energy = pt.toFixed(3);
                        }
                        listenergy.push(data);
                    })

                }
                let obj = {
                    type: "",
                    statement: statement,
                    loc_info: {
                        locname: location,
                        floor: floor,
                        area: room,
                        desk_name: desk,
                        time: time
                    },
                    occavg: occavg,
                    sitting: sitting.sit,
                    standing: sitting.std,
                    inuse: books.inuse,
                    inmeeting: books.inmeeting,
                    tenergy: totalenergy.toFixed(3),
                    peakenergy: sitting.energy,
                    daily: listenergy,
                    category: period.toString(),
                    energy: energygraph.toString(),
                    occpancy: occgraph.toString()
                }
                obj.logo= await getCustomLogo(req.headers.companyId)
                let paths = await PDFGenerate('booking-template', `Booking_${new Date().getTime()}_daily`, obj);
                if (paths[0]) {
                    res.status(200).download(paths[1]);
                } else {
                    res.send({
                        status: 0,
                        message: "Something wnet wrong, Please try again later."
                    });
                }


            } else {
                res.send({
                    status: 0,
                    message: "no report information"
                });
            }
        } else if (req.query.report_type && (req.query.report_type === 'weekly' || req.query.report_type === 'monthly' || req.query.report_type === 'custom')) {
            try {
                let bookings = await BookingDayReport(req.headers.user_id, req.query.from, req.query.to);
                if (bookings.length > 0) {
                    let timesec = await timeregion(bookings[0].region_time);
                    let start = (parseInt('' + req.query.from) + parseInt(timesec));
                    let end = (parseInt('' + req.query.to) + parseInt(timesec));
                    let days = Math.round(((end - start) / 1000) / (24 * 60 * 60))
                    let dates = new Array(days).fill(0);
                    let occavg = 0
                    dates.forEach((ele, index) => {
                        let ts = new Date(start + (index * 24 * 60 * 60 * 1000));
                        ts.setUTCHours(0, 0, 0, 0);
                        dates[index] = ts.getTime();
                    })
                    let {
                        statement
                    } = await BookingHeading(start, end, true);
                    let totalbooking = {}
                    let PromArr = [];
                    let EnergyArr = [];
                    let location = [];
                    let floor = [];
                    let room = [];
                    let desk = [];
                    let book_ids = bookings.map((ele) => {
                        if (!location.includes(ele.location)) {
                            location.push(ele.location)
                        }
                        if (!floor.includes(ele.floor)) {
                            floor.push(ele.floor)
                        }
                        if (!room.includes(ele.room)) {
                            room.push(ele.room)
                        }
                        if (!desk.includes(ele.desk)) {
                            desk.push(ele.desk)
                        }
                        let start = (parseInt('' + ele.start) + parseInt(timesec));
                        let end = (parseInt('' + ele.end) + parseInt(timesec));
                        PromArr.push(getOccpanctState(ele.desk_id, start, end));
                        EnergyArr.push(getEnergyData(ele.desk_id, start, end));
                        let time = new Date(start);
                        time.setUTCHours(0, 0, 0, 0);
                        let total = totalbooking[time.getTime()];
                        if (total == undefined) {
                            total = 0
                        }
                        total += (end - start) / 1000;
                        totalbooking[time.getTime()] = parseInt(total);
                        return ele.uuid
                    })
                    location = location.join(",");
                    floor = floor.join(",");
                    let totalenergy = 0
                    let [bookstate, bookhistory] = await findRecordinMongo('booking_history', {
                        uuid: {
                            $in: book_ids
                        },
                        state: {
                            $in: [1, 2, 3]
                        }
                    }, {
                        _id: 0,
                        state: 1,
                        ts: 1
                    }, {
                        ts: 1
                    }, 0);
                    let books = {
                        inuse: 0,
                        inmeeting: 0
                    };
                    if (bookstate) {
                        bookhistory.forEach((ele, index) => {
                            if (index > 0) {
                                let old = bookhistory[index - 1];
                                if ((ele.state == 3 || ele.state == 2) && old.state == 1) {
                                    books.inuse += (((ele.ts) - (old.ts)) / 1000)
                                }
                                if ((ele.state == 1 || ele.state == 3) && old.state == 2) {
                                    books.inmeeting += (((ele.ts) - (old.ts)) / 1000)
                                }
                            }
                        })
                    } else {
                        bookings.forEach((ele) => {
                            books.inuse += (ele.end - ele.start) / 1000;
                            books.inmeeting = 0
                        });
                    }
                    books.inuse = secondsToHrMinSec(books.inuse);
                    books.inmeeting = secondsToHrMinSec(books.inmeeting);
                    let record = await PromCallApi(PromArr)
                    let energyrecords = await PromCallApi(EnergyArr);
                    let records = record.sort((a, b) => a.ts - b.ts);
                    let occgr = records.reduce((prv, curr, index) => {
                        let ts = new Date(curr.ts);
                        ts.setUTCHours(0, 0, 0, 0);
                        let last = prv[`${ts.getTime()}`]
                        if (last == undefined) {
                            last = {
                                occ: 0,
                                sit: 0,
                                std: 0,
                                energy: 0
                            };
                        }
                        if (index > 0) {
                            let olddata = records[index - 1];
                            if ((olddata.state == 1) && (curr.state == 1 || curr.state == 0)) {
                                let sec = parseInt((curr.ts - olddata.ts) / 1000);
                                last.occ += sec
                                if (olddata.distance > 90) {
                                    last.std += sec
                                } else {
                                    last.sit += sec
                                }
                            }
                        }
                        prv[`${ts.getTime()}`] = last;
                        return prv;
                    }, {})
                    let energygrp = energyrecords.reduce((prv, cur) => {
                        let ts = new Date(cur.ts);
                        ts.setUTCHours(0, 0, 0, 0);
                        let enerts = prv[`${ts.getTime()}`];
                        let sum = (cur.Pt).reduce((pr, cu) => pr + cu);
                        if (enerts == undefined) {
                            enerts = 0
                        }
                        totalenergy += parseFloat((sum / 1000).toFixed(3))
                        enerts += parseFloat((sum / 1000).toFixed(3));
                        prv[`${ts.getTime()}`] = parseFloat((enerts).toFixed(3));
                        return prv;
                    }, {})
                    let obj = {
                        type: `${req.query.report_type}`,
                        statement: statement,
                        loc_info: {
                            locname: location,
                            floor: floor,
                            bookings: bookings.length
                        },
                        occavg: occavg,
                        inuse: books.inuse,
                        inmeeting: books.inmeeting,
                        tenergy: totalenergy.toFixed(3),
                        daily: {},
                        category: [],
                        energy: [],
                        occpancy: []
                    }
                    obj.daily = dates.reduce((prv, curr) => {
                        let date = (new Date(parseInt(curr)).toUTCString()).split(' ');
                        let data = {
                            occ: 0,
                            sit: 0,
                            std: 0,
                            energy: 0
                        }
                        data.date = `${date[1]} ${date[2]} ${date[3]} ${date[0].replace(/,/g,'')}`
                        data.cdate = `${date[2]} ${date[1]} ${date[0].replace(/,/g,'')}`
                        if (energygrp[`${curr}`] != undefined) {
                            data.energy = energygrp[`${curr}`]
                        }
                        if (occgr[`${curr}`] != undefined) {
                            let occdata = occgr[`${curr}`];
                            let pre = parseFloat(((occdata.occ / totalbooking[`${curr}`]) * 100).toFixed(2));
                            if (pre > 100) {
                                pre = 100;
                            }
                            data.occ = pre;
                            if (occdata.occ > 0) {
                                data.sit = parseFloat(((occdata.sit / occdata.occ) * 100).toFixed(2));
                                data.std = parseFloat(((occdata.std / occdata.occ) * 100).toFixed(2));
                            }
                        }
                        if(isNaN(data.sit)){
                            data.sit=0;
                            data.std=0;
                        }
                        if(isNaN(data.occ)){
                            data.occ=0;
                        }
                        if(totalbooking[`${curr}`]!=undefined){
                            obj.energy.push(data.energy);
                            obj.occpancy.push(data.occ);
                            occavg += data.occ;
                            obj.category.push(curr);
                            prv.push(data);
                        }
                        
                        return prv
                    }, [])
                    obj.occavg = parseFloat(((occavg / (100 * Object.keys(totalbooking).length)) * 100).toFixed(2))
                    obj.category = (obj.category).toString();
                    obj.energy = (obj.energy).toString();
                    obj.occpancy = (obj.occpancy).toString();
                    obj.logo= await getCustomLogo(req.headers.companyId)
                    let paths = await PDFGenerate('booking-template-wm', `Booking_wm_${new Date().getTime()}`, obj);
                    if (paths[0]) {
                        res.status(200).download(paths[1]);
                    } else {
                        res.send({
                            status: 0,
                            message: "Something wnet wrong, Please try again later."
                        });
                    }
                } else {
                    res.send({
                        status: 0,
                        message: "no report information"
                    });
                }
            } catch (err) {
                console.log(err);
                res.send({
                    status: 0,
                    message: err.message
                });
            }
            
        } else if(req.query.report_type && (req.query.report_type === 'bh_report' && req.query.type)){
            let locations = await QuaryMysql(`select sld.location_name,ld.location_name as floorname,(select count(*) from device_desks as dd join location_rooms as lr on lr.room_id=dd.room_id where lr.location_id =ld.location_id and lr.is_active = true and lr.is_default=false) as desk_count from super_locations_details as sld join locations_details as ld on ld.loc_id=sld.loc_id where ld.is_active=true and ld.location_id ='${req.query.floor_id}'`);
            if(locations.length>0){
                
                let obj={
                    loc_info:locations[0],
                    usage:false,
                    meeting: false
                }
                let bookings= await QuaryMysql(`select ud.name,concat(lr.room_name,',',dd.name) as desk_loc,bd.start,bd.end,bd.region_time,bd.created_date  from booking_details as bd join location_rooms as lr on lr.room_id=bd.room_id join device_desks as dd on bd.desk_id=dd.desk_id join user_details as ud on ud.user_id=bd.user_id where bd.location_id='${req.query.floor_id}' and bd.start between ${req.query.start} and ${req.query.end} and bd.state=0 order by bd.start ASC;`)
                if(bookings.length>0){
                    let timesec = await timeregion(bookings[0].region_time);
                    let { statement } = await BookingHeading((parseInt(req.query.start)+parseInt(timesec)), (parseInt(req.query.end)+parseInt(timesec)-10000), true);
                    let stta=statement.split("-");
                    obj.statement=stta[0];
                    if(stta[0]!=stta[1]){
                        obj.statement=statement;
                    }
                    obj.type=req.query.type;
                    obj.loc_info.book_count= bookings.length;
                    let Promdata=[]
                    bookings.forEach((ele)=>{
                        Promdata.push(BookingData(ele));
                    })
                    Promise.all(Promdata).then(async (result)=>{
                        obj.daily=result;
                        let thours=result.reduce((prv,curr)=>{
                            prv+=curr.hours;
                            return prv;
                        },0);
                        obj.thours=await secondsToHrMinSec(thours*60);
                        obj.logo= await getCustomLogo(req.headers.companyId);
                        if (req.query.csv) {
                            const fields = [
                                { label: 'Person Name', value: 'name' },
                                { label: 'Room, Desk', value: 'desk_loc' },
                                { label: 'Created Time', value: 'booked' },
                                { label: 'Booking Time', value: 'booking' },
                            ];
                            const csv = json2csv.parse(obj.daily, { fields: fields });
                            res.setHeader('Content-Type', 'text/csv');
                            res.setHeader('Content-Disposition', `attachment; filename="${obj.type}_${req.query.location_id}_${new Date().getTime()}.csv"`);
                            return res.status(200).send(csv);
                        }
                        let paths = await PDFGenerate('booking-history-template', `Booking_history_${new Date().getTime()}_daily`, obj);
                            if (paths[0]) {
                                res.status(200).download(paths[1]);
                            } else {
                                res.send({
                                    status: 0,
                                    message: "Something wnet wrong, Please try again later."
                                });
                            }
                    })
                    
                }else {
                    res.send({
                        status: 0,
                        message: "report not found"
                    });
                }
                
            }else{
                res.send({
                    status: 0,
                    message: "no location found"
                });
            }

        } else if(req.query.report_type && (req.query.report_type === 'mbh_report' && req.query.type)){
            let locations = await QuaryMysql(`select sld.location_name,ld.location_name as floorname,(select count(*) from location_rooms as lr where lr.location_id =ld.location_id and lr.room_type='1' and lr.is_active = true and lr.is_default=false) as desk_count from super_locations_details as sld join locations_details as ld on ld.loc_id=sld.loc_id where ld.is_active=true and ld.location_id ='${req.query.floor_id}'`);
            if(locations.length>0){
                let obj={
                    loc_info:locations[0],
                    usage:true,
                    meeting: true
                }
                let bookings= await QuaryMysql(`select ud.name,lr.room_name as desk_loc,bd.start,bd.end,bd.state,bd.region_time,bd.start_old,bd.end_old,bd.created_date from booking_details as bd join user_details as ud on ud.user_id=bd.user_id join location_rooms as lr on lr.room_id=bd.room_id where lr.room_type='1' and bd.location_id='${req.query.floor_id}' and bd.start between ${req.query.start} and ${req.query.end} order by bd.start ASC;`)
                if(bookings.length>0){
                    let timesec = await timeregion(bookings[0].region_time);
                    let { statement } = await BookingHeading((parseInt(req.query.start)+parseInt(timesec)), (parseInt(req.query.end)+parseInt(timesec)-10000), true);
                    let stta=statement.split("-");
                    obj.statement=stta[0];
                    if(stta[0]!=stta[1]){
                        obj.statement=statement;
                    }  
                    obj.type=req.query.type;
                    obj.loc_info.book_count= bookings.length;
                    obj.loc_info.check_in= 0;
                    obj.loc_info.cancelled= 0;
                    let Promdata=[]
                    bookings.forEach((ele)=>{
                        if(ele.state && ['1','2','3'].includes(`${ele.state}`)){
                            obj.loc_info.check_in+=1
                        }
                        if(ele.state && ['4'].includes(`${ele.state}`)){
                            obj.loc_info.cancelled+=1
                        }
                        Promdata.push(BookingData(ele));
                    })
                    Promise.all(Promdata).then(async (result)=>{
                        obj.daily=result;
                        //console.log(JSON.stringify(result))
                        let thours=result.reduce((prv,curr)=>{
                            if(curr.state==3){
                                prv+=curr.hours;
                            }
                            return prv;
                        },0)
                        obj.thours=await secondsToHrMinSec(thours*60);
                        obj.logo= await getCustomLogo(req.headers.companyId)
                        if (req.query.csv) {
                            const fields = [
                                { label: 'Person Name', value: 'name' },
                                { label: 'Room, Desk', value: 'desk_loc' },
                                { label: 'Status', value: 'status' },
                                { label: 'Created Time', value: 'booked' },
                                { label: 'Booking Time', value: 'booking' },
                                { label: 'Usage Time', value: 'time' }
                            ];
                            const csv = json2csv.parse(obj.daily, { fields: fields });
                            res.setHeader('Content-Type', 'text/csv');
                            res.setHeader('Content-Disposition', `attachment; filename="${obj.type}_${req.query.location_id}_${new Date().getTime()}.csv"`);
                            return res.status(200).send(csv);
                        }
                        let paths = await PDFGenerate('booking-past-history-template', `Meeting_room_${new Date().getTime()}`, obj);
                            if (paths[0]) {
                                res.status(200).download(paths[1]);
                            } else {
                                res.send({
                                    status: 0,
                                    message: "Something wnet wrong, Please try again later."
                                });
                            }
                    })
                    
                }else{
                    res.status(200).send({
                        status: 0,
                        message: "report not found"
                    });
                }
                
            }else{
                res.send({
                    status: 0,
                    message: "no location found"
                });
            }

        } else if(req.query.report_type && (req.query.report_type === 'pbh_report' && req.query.type)){
            let locations = await QuaryMysql(`select sld.location_name,ld.location_name as floorname,(select count(*) from device_desks as dd join location_rooms as lr on lr.room_id=dd.room_id where lr.location_id =ld.location_id and lr.is_active = true and lr.is_default=false) as desk_count from super_locations_details as sld join locations_details as ld on ld.loc_id=sld.loc_id where ld.is_active=true and ld.location_id ='${req.query.floor_id}'`);
            if(locations.length>0){
                
                let obj={
                    loc_info:locations[0],
                    usage:true,
                    meeting: false
                }
                let bookings= await QuaryMysql(`select ud.name,concat(lr.room_name,',',dd.name) as desk_loc,bd.start,bd.end,bd.state,bd.region_time,bd.start_old,bd.end_old,bd.created_date  from booking_details as bd join location_rooms as lr on lr.room_id=bd.room_id join device_desks as dd on bd.desk_id=dd.desk_id join user_details as ud on ud.user_id=bd.user_id where bd.location_id='${req.query.floor_id}' and bd.start between ${req.query.start} and ${req.query.end} order by bd.start ASC;`)
                if(bookings.length>0){
                    let timesec = await timeregion(bookings[0].region_time);
                    let { statement } = await BookingHeading((parseInt(req.query.start)+parseInt(timesec)), (parseInt(req.query.end)+parseInt(timesec)-10000), true);
                    let stta=statement.split("-");
                    obj.statement=stta[0];
                    if(stta[0]!=stta[1]){
                        obj.statement=statement;
                    }  
                    obj.type=req.query.type;
                    obj.loc_info.book_count= bookings.length;
                    obj.loc_info.check_in= 0;
                    obj.loc_info.cancelled= 0;
                    let Promdata=[]
                    bookings.forEach((ele)=>{
                        if(ele.state && ['1','2','3'].includes(`${ele.state}`)){
                            obj.loc_info.check_in+=1
                        }
                        if(ele.state && ['4'].includes(`${ele.state}`)){
                            obj.loc_info.cancelled+=1
                        }
                        Promdata.push(BookingData(ele));
                    })
                    Promise.all(Promdata).then(async (result)=>{
                        obj.daily=result;
                        //console.log(JSON.stringify(result))
                        let thours=result.reduce((prv,curr)=>{
                            if(curr.state==3){
                                prv+=curr.hours;
                            }
                            return prv;
                        },0)
                        obj.thours=await secondsToHrMinSec(thours*60);
                        obj.logo= await getCustomLogo(req.headers.companyId)
                        if (req.query.csv) {
                            const fields = [
                                { label: 'Person Name', value: 'name' },
                                { label: 'Room, Desk', value: 'desk_loc' },
                                { label: 'Status', value: 'status' },
                                { label: 'Created Time', value: 'booked' },
                                { label: 'Booking Time', value: 'booking' },
                                { label: 'Usage Time', value: 'time' }
                            ];
                            const csv = json2csv.parse(obj.daily, { fields: fields });
                            res.setHeader('Content-Type', 'text/csv');
                            res.setHeader('Content-Disposition', `attachment; filename="${obj.type}_${req.query.location_id}_${new Date().getTime()}.csv"`);
                            return res.status(200).send(csv);
                        }
                        let paths = await PDFGenerate('booking-past-history-template', `Booking_history_${new Date().getTime()}_daily`, obj);
                            if (paths[0]) {
                                res.status(200).download(paths[1]);
                            } else {
                                res.send({
                                    status: 0,
                                    message: "Something wnet wrong, Please try again later."
                                });
                            }
                    })
                    
                }else{
                    res.status(200).send({
                        status: 0,
                        message: "report not found"
                    });
                }
                
            }else{
                res.send({
                    status: 0,
                    message: "no location found"
                });
            }

        } else if(req.query.report_type && (req.query.report_type === 'desk_report' && req.query.type)){
            let locations = await QuaryMysql(`SELECT sld.location_name as loc_name, fl.location_name as floor_name, lr.room_name, name as desk_name FROM device_desks as dd join location_rooms as lr on dd.room_id = lr.room_id join locations_details as fl on lr.location_id = fl.location_id join super_locations_details as sld on fl.loc_id = sld.loc_id where dd.desk_id = '${req.query.desk_id}' and dd.is_active=true;`);
            if(locations.length>0){
                let obj={
                    loc_info:locations[0],
                    usage:false,
                    meeting: false
                }
                let bookings= await QuaryMysql(`select ud.name,bd.start,bd.end,bd.region_time,bd.created_date from booking_details as bd join user_details as ud on ud.user_id=bd.user_id where bd.desk_id='${req.query.desk_id}' and bd.start between ${req.query.start} and ${req.query.end} order by bd.start ASC;`)
                if(bookings.length>0){
                    let timesec = await timeregion(bookings[0].region_time);
                    let { statement } = await BookingHeading((parseInt(req.query.start)+parseInt(timesec)), (parseInt(req.query.end)+parseInt(timesec)-10000), true);
                    let stta=statement.split("-");
                    obj.statement=stta[0];
                    if(stta[0]!=stta[1]){
                        obj.statement=statement;
                    }
                    obj.type=req.query.type;
                    obj.loc_info.book_count= bookings.length;
                    let Promdata=[]
                    bookings.forEach((ele)=>{
                        Promdata.push(BookingData(ele));
                    })
                    Promise.all(Promdata).then(async (result)=>{
                        obj.daily=result;
                        let thours=result.reduce((prv,curr)=>{
                            prv+=curr.hours;
                            return prv;
                        },0);
                        obj.thours=await secondsToHrMinSec(thours*60);
                        obj.logo= await getCustomLogo(req.headers.companyId);
                        if (req.query.csv) {
                            const fields = [
                                { label: 'Person Name', value: 'name' },
                                { label: 'Status', value: 'status' },
                                { label: 'Created Time', value: 'booked' },
                                { label: 'Booking Time', value: 'booking' },
                                { label: 'Usage Time', value: 'time' }
                            ];
                            const csv = json2csv.parse(obj.daily, { fields: fields });
                            res.setHeader('Content-Type', 'text/csv');
                            res.setHeader('Content-Disposition', `attachment; filename="${obj.type}_${req.query.location_id}_${new Date().getTime()}.csv"`);
                            return res.status(200).send(csv);
                        }
                        let paths = await PDFGenerate('desk-booking-report-template', `Desk_Booking_${new Date().getTime()}`, obj);
                            if (paths[0]) {
                                res.status(200).download(paths[1]);
                            } else {
                                res.send({
                                    status: 0,
                                    message: "Something wnet wrong, Please try again later."
                                });
                            }
                    })
                    
                }else {
                    res.send({
                        status: 0,
                        message: "report not found"
                    });
                }
                
            }else{
                res.send({
                    status: 0,
                    message: "no location found"
                });
            }

        }else {
            res.status(200).send({
                status: 0,
                message: "report not found"
            });
        }

    },
    reporttest: async (req, res) => {
        let obj = {
            "type": "weeklyss",
            "statement": "Feb 23 2022 - Feb 28 2022",
            "loc_info": {
                "locname": "Cyber Towers",
                "floor": "10th floor",
                "bookings": 13
            },
            "occavg": 87.32,
            "inuse": "01h 44m 45sec",
            "inmeeting": "11m 22sec",
            "tenergy": "0.042",
            "daily": [{
                    "occ": 77.72,
                    "sit": 100,
                    "std": 0,
                    "energy": 0.041,
                    "date": "23 Feb 2022 Wed",
                    "cdate": "Feb 23 Wed"
                },
                {
                    "occ": 0,
                    "sit": 0,
                    "std": 0,
                    "energy": 0,
                    "date": "24 Feb 2022 Thu",
                    "cdate": "Feb 24 Thu"
                },
                {
                    "occ": 100,
                    "sit": 100,
                    "std": 0,
                    "energy": 0,
                    "date": "25 Feb 2022 Fri",
                    "cdate": "Feb 25 Fri"
                },
                {
                    "occ": 0,
                    "sit": 0,
                    "std": 0,
                    "energy": 0,
                    "date": "26 Feb 2022 Sat",
                    "cdate": "Feb 26 Sat"
                },
                {
                    "occ": 0,
                    "sit": 0,
                    "std": 0,
                    "energy": 0,
                    "date": "27 Feb 2022 Sun",
                    "cdate": "Feb 27 Sun"
                },
                {
                    "occ": 84.25,
                    "sit": 100,
                    "std": 0,
                    "energy": 0.001,
                    "date": "28 Feb 2022 Mon",
                    "cdate": "Feb 28 Mon"
                }
            ],
            "category": [
                "Feb 23 Wed",
                "Feb 24 Thu",
                "Feb 25 Fri",
                "Feb 26 Sat",
                "Feb 27 Sun",
                "Feb 28 Mon"
            ],
            "energy": [
                0.041,
                0,
                0,
                0,
                0,
                0.001
            ],
            "occpancy": [
                77.72,
                0,
                100,
                0,
                0,
                84.25
            ]
        }
        obj.category = (obj.category).toString();
        obj.energy = (obj.energy).toString()
        obj.occpancy = (obj.occpancy).toString()
        let paths = await PDFGenerate('booking-template-wm', `Booking_wm_${new Date().getTime()}`, obj);
        if (paths[0]) {
            res.status(200).download(paths[1]);
        } else {
            res.send({
                status: 0,
                message: "Invalid information"
            });
        }
    }
}
 async function BookingData(data){
     return new Promise(async (reslove)=>{
        let timesec = await timeregion(data.region_time);
        let { time,statement, dateTime } = await BookingHeading((data.start+parseInt(timesec)), (data.end+parseInt(timesec)-10000), false);
        data.time=time.split(',');
        let start_old=data.start;
        let end_old=data.end;
        if(data.state==4 || data.state==0){
            data.time="-";
        }
        if(data.state==1 || data.state==2){
            if(data.start_old!=undefined && data.start_old>0){
                start_old=data.start_old;
            }
            data.time[1] = (data.time[1]).split('-')[0];
        }
        if(data.state==3){
            if(data.start_old!=undefined && data.start_old>0){
                start_old=data.start_old;
            }

            if(data.end_old!=undefined && data.end_old>0){
                end_old=data.end_old;
            }
        }
        let abookings= await BookingHeading((start_old+parseInt(timesec)), (end_old+parseInt(timesec)-10000), false);
        data.booking = (abookings.statement).split(',');
        if(data.created_date!=undefined){
            try{
                let cerated= new Date(new Date(data.created_date).getTime()+parseInt(timesec)).toUTCString();
                let date2 = cerated.split(' ');
                let date1 = date2[4].split(':');
                let ds = 'AM'
                if (date1[0] >= 12) {
                    ds = 'PM'
                    if (date1[0] > 12) {
                        date1[0] = date1[0] - 12;
                    }
                }
                data.booked = `${date2[2]} ${date2[1]} ${date2[3]}, ${date1[0]}:${date1[1]} ${ds}`;
            }
            catch(err){

            }   
        }
        if(data.state!=undefined){
            data.state=data.state;
            data.status='Booked';
            if(data.state==1 || data.state==2){
                data.status='Check In'; 
            }
            if(data.state==3){
                data.status='Completed'; 
            }
            if(data.state==4){
                data.status='Cancelled';
            }
        }
        data.hours=(parseInt(((data.end-data.start)/1000)/60))
        reslove(data)
     })
 }
async function PromCallApi(PromArr) {
    return new Promise((reslove) => {
        let records = []
        Promise.all(PromArr).then(result => {
            result.forEach((ele) => {
                records = [...records, ...ele]
            });
            reslove(records)
        })
    })
}
async function BookingReport(booking_id) {
    return new Promise(async (reslove) => {
        let quary = `select sld.location_name as location,ld.location_name as floor,lr.room_name as room,dd.name as desk,bd.start,bd.end,bd.desk_id,bd.region_time,bd.state from booking_details as bd join super_locations_details as sld on sld.loc_id=bd.sup_loc_id join locations_details as ld on ld.location_id=bd.location_id join location_rooms as lr on lr.room_id=bd.room_id join device_desks as dd on dd.desk_id=bd.desk_id where bd.uuid='${booking_id}'  order by bd.start ASC`;
        let booking = await QuaryMysql(quary);
        reslove(booking)
    })
}
async function BookingDayReport(user_id, start, end) {
    return new Promise(async (reslove) => {
        if(start>0 & end>0){
            let quary = `select sld.location_name as location,ld.location_name as floor,lr.room_name as room,dd.name as desk,bd.uuid,bd.start,bd.end,bd.desk_id,bd.region_time,bd.state from booking_details as bd join super_locations_details as sld on sld.loc_id=bd.sup_loc_id join locations_details as ld on ld.location_id=bd.location_id join location_rooms as lr on lr.room_id=bd.room_id join device_desks as dd on dd.desk_id=bd.desk_id where bd.start > ${start} and bd.end < ${end} and bd.user_id = '${user_id}' and bd.state =3 order by bd.start ASC`;
            let booking = await QuaryMysql(quary);
            reslove(booking)
        }else{
            reslove([]);
        }
        
    })
}
async function BookingHeading(start, end, state) {
    return new Promise(reslove => {
        let start_date = new Date(start).toUTCString();
        let date2 = start_date.split(' ');
        let date1 = date2[4].split(':');
        let ds = 'AM'
        if (date1[0] >= 12) {
            ds = 'PM'
            if (date1[0] > 12) {
                date1[0] = date1[0] - 12;
            }
        }
        let end_date = new Date(end).toUTCString();
        let date3 = end_date.split(' ');
        let date4 = date3[4].split(':');
        let ds1 = 'AM'
        if (date4[0] >= 12) {
            ds1 = 'PM'
            if (date4[0] > 12) {
                date4[0] = date4[0] - 12;
            }
        }
        let statement = `${date2[2]} ${date2[1]} ${date2[3]}, ${date1[0]}:${date1[1]} ${ds} - ${date4[0]}:${date4[1]} ${ds1}`
        if (`${date2[2]} ${date2[1]} ${date2[3]}` != `${date3[2]} ${date3[1]} ${date3[3]}` && !state) {
            statement = `${date2[2]} ${date2[1]} ${date2[3]}, ${date1[0]}:${date1[1]} ${ds} - ${date3[2]} ${date3[1]} ${date3[3]}, ${date4[0]}:${date4[1]} ${ds1}`;
        }
        if (state) {
            statement = `${date2[2]} ${date2[1]} ${date2[3]} - ${date3[2]} ${date3[1]} ${date3[3]}`
        }
        reslove({
            statement: `${statement}`,
            time: `${date2[2]} ${date2[1]} ${date2[3]}, ${date1[0]}:${date1[1]} ${ds} - ${date4[0]}:${date4[1]} ${ds1}`,
            dateTime: `${new Date(start).toDateString()} ${date1[0]}:${date1[1]} ${ds} - ${new Date(end).toDateString()} ${date4[0]}:${date4[1]} ${ds1}`
        })
    })

}



function secondsToHrMinSec(sec) {
    let hours = Math.floor(sec / 3600);
    let mins = Math.floor((sec / 60) % 60);
    let seconds = Math.floor(sec % 60);
    let dispaly = ''
    if (hours > 0) {
        if ((`${hours}`).length == 1) {
            hours = `0${hours}`
        }
        dispaly += `${hours}h `
    }
    if (mins > 0 || hours > 0) {
        if ((`${mins}`).length == 1) {
            mins = `0${mins}`
        }
        dispaly += `${mins}m `
    }
    if ((`${seconds}`).length == 1) {
        seconds = `0${seconds}`
    }
    dispaly += `${seconds}sec`
    //Math.floor(sec / 3600) + 'h' + ' ' + Math.floor((sec / 60) % 60) + 'm' + ' ' + Math.floor(sec % 60) + 's';
    return dispaly;
}

const PDFGenerate = async (template_name, filename, ObjData) => {
    return new Promise(async (resolve, reject) => {
        try {
            let pathForPdf = path.join(__dirname, '../../PDFFiles/');
            console.log(`PDF Error:${ObjData}`)
            ejs.renderFile(path.join(__dirname, '/templates/', `${template_name}.ejs`), ObjData, async (err, ress) => {
                if (err) {
                    console.log(`PDF Error:${err}`)
                    reject(err);
                } else {
                    let PDFpath = `${pathForPdf}${filename}.pdf`
                    let data = {};
                    const template = hb.compile(ress, {
                        strict: true
                    });
                    const result = template(data);
                    const html = result;
                    const browser = await puppeteer.launch({
                        headless: "new"});
                    const page = await browser.newPage();
                    try {
                        await page.setContent(html);
                        await page.pdf({
                            path: `${PDFpath}`,
                            format: 'A4',
                            margin: {
                                top: '1cm',
                                bottom: '1.5cm',
                            }
                        });
                        await browser.close();
                        console.log("PDF Generated");
                        resolve([true, PDFpath]);
                    } catch (error) {
                        console.error("Error generating PDF:", error);
                        await browser.close();
                        reject(error);
                    }
                }
            });
        } catch (error) {
            console.log(`PDF Error:${error}`)
            reject(error);
        }
    });
}

async function getDeskEnergy(room_ids, start, end, type) {
    return new Promise(async (reslove) => {
        if (type) {
            let desks = await mysql.getModels().DeviceDisks.findAll({
                where: {
                    room_id: {
                        [Op.in]: room_ids
                    },
                    is_active: true
                },
                attributes: ['desk_id', 'room_id']
            });
            if (desks.length > 0) {
                let deskIds = desks.map(ele => {
                    return ele.desk_id
                });
                let roomenergy = {}
                let deskrooms = desks.reduce((prev, curr) => {
                    prev[curr.desk_id] = curr.room_id;
                    return prev;
                }, {});
                let [states, results] = await findRecordinMongo('desk_energy_days', {
                    desk_id: {
                        $in: deskIds
                    },
                    ts: {
                        $gte: start,
                        $lt: end
                    }
                }, {
                    _id: 0,
                    Pt: 1,
                    ts: 1,
                    desk_id: 1
                }, {
                    ts: 1
                }, 0);
                if (states && results.length > 0) {
                    let energy = results.reduce((prev, curr) => {
                        let energys = prev[`${curr.ts}`];
                        if (energys == undefined) {
                            energys = 0;
                        }
                        let data = curr.Pt;
                        let renergy = roomenergy[`${deskrooms[`${curr.desk_id}`]}`];
                        if (renergy == undefined) {
                            renergy = 0
                        }
                        renergy += parseFloat((data.reduce((pre, cur) => pre + cur) / 1000).toFixed(3))
                        roomenergy[`${deskrooms[`${curr.desk_id}`]}`] = renergy;
                        energys += parseFloat((data.reduce((pre, cur) => pre + cur) / 1000).toFixed(3));
                        prev[`${curr.ts}`] = energys;
                        return prev;
                    }, {})
                    reslove([true, energy, roomenergy])
                } else {
                    reslove([false, {}, {}])
                }
            } else {
                reslove([false, {}, {}])
            }
        } else {
            reslove([false, {}, {}])
        }

    })
}
async function getDeskOccpancy(quary, type) {
    return new Promise(async (reslove) => {
        if (type) {
            let [states, results] = await findRecordinMongo('desk_occpancy_days', quary, {
                _id: 0,
                sitting: 1,
                standing: 1,
                ts: 1,
                room_id: 1
            }, {
                ts: 1
            }, 0);
            if (states && results.length > 0) {
                let occpanct = results.reduce((prv, curr) => {
                    let datas = prv.occ[`${curr.ts}`];
                    let datats = prv.ts[`${curr.ts}`];
                    if (datas == undefined) {
                        datats = 0
                        datas = {
                            sitting: 0,
                            standing: 0,
                            energy: 0,
                            total: 0
                        }
                    }
                    datats += 1;
                    datas.sitting += curr.sitting;
                    datas.standing += curr.standing;
                    datas.total += (curr.sitting + curr.standing);
                    prv.occ[`${curr.ts}`] = datas
                    prv.ts[`${curr.ts}`] = datats;
                    //room
                    let rdatas = prv.rocc[`${curr.room_id}`];
                    let rdatats = prv.rcount[`${curr.room_id}`];
                    if (rdatas == undefined) {
                        rdatats = 0
                        rdatas = {
                            occ: 0,
                            energy: 0
                        }
                    }
                    let per = (parseFloat((((curr.sitting + curr.standing) / (10 * 60 * 60)) * 100)));
                    if (per > 100) {
                        per = 100
                    }
                    rdatas.occ += per
                    rdatats += 1;
                    prv.rocc[`${curr.room_id}`] = rdatas;
                    prv.rcount[`${curr.room_id}`] = rdatats;
                    return prv;
                }, {
                    occ: {},
                    ts: {},
                    rocc: {},
                    rcount: {}
                });
                let occs = Object.keys(occpanct.occ).reduce((prev, curr) => {
                    let data = occpanct.occ[curr];
                    let tstotal = occpanct.ts[curr];
                    let datas = prev[curr];
                    if (datas == undefined) {
                        datas = {
                            sit: 0,
                            std: 0,
                            occ: 0,
                            energy: 0,
                            ts: curr
                        }
                    }
                    if (data.total > 0) {
                        datas.sit = parseFloat((data.sitting / data.total).toFixed(2)) * 100
                        datas.std = parseFloat((data.standing / data.total).toFixed(2)) * 100
                    }
                    let pre = parseFloat(((data.total / (tstotal * (10 * 60 * 60))) * 100).toFixed(2));
                    if (pre > 100) {
                        pre = 100;
                    }
                    datas.occ = pre;
                    prev[curr] = datas;
                    return prev;
                }, {})
                let roomocc = Object.keys(occpanct.rocc).reduce((prev, curr) => {
                    let data = occpanct.rocc[`${curr}`];
                    data.occ = parseFloat((data.occ / occpanct.rcount[`${curr}`]).toFixed(2));
                    prev[`${curr}`] = data;
                    return prev;
                }, {})
                reslove([true, occs, roomocc])
            } else {
                reslove([false, {}])
            }
        } else {
            reslove([false, {}])
        }

    })
}
const getOccpanctState = (async (desk_id, start, end) => {
    return new Promise(async (reslove) => {
        let [laststate, lastocrecord] = await findRecordinMongo('occpancy_states', {
            desk_id: desk_id,
            ts: {
                $lt: start
            }
        }, {
            _id: 0,
            state: 1,
            distance: 1,
            ts: 1
        }, {
            ts: -1
        }, 1);
        if (lastocrecord.length > 0) {
            let last = lastocrecord[0]
            last.ts = start;
            lastocrecord[0] = JSON.parse(JSON.stringify(last));
            let lastinfo = JSON.parse(JSON.stringify(last));
            last.state = "0"
            last.ts = (start - 100)
            lastocrecord[1] = lastinfo;
        }
        let [occstate, occrecords] = await findRecordinMongo('occpancy_states', {
            desk_id: desk_id,
            ts: {
                $gte: start,
                $lte: end
            }
        }, {
            _id: 0,
            state: 1,
            distance: 1,
            ts: 1
        }, {
            ts: 1
        }, 0);
        if (occrecords.length > 0) {
            let last = JSON.parse(JSON.stringify(occrecords[(occrecords.length) - 1]));
            last.state = "0";
            last.ts = end;
            occrecords.push(last);
        } else if (lastocrecord.length > 0) {
            let last = lastocrecord[0]
            last.state = "0";
            last.ts = end;
            occrecords.push(last);
        }
        let records = [...lastocrecord, ...occrecords];
        records = records.sort((a, b) => a.ts - b.ts);
        reslove(records);
    })

})

const getEnergyData = (async (desk_id, start, end) => {
    return new Promise(async (reslove) => {
        let [energystate, energyrecords] = await findRecordinMongo('desk_energy_hours', {
            desk_id: desk_id,
            ts: {
                $gte: start,
                $lte: end
            }
        }, {
            _id: 0,
            Pt: 1,
            ts: 1
        }, {
            ts: 1
        }, 0);
        reslove(energyrecords);
    })
})