const antennaFiles = [
"data/Huawei_A104518R1V07.txt",
"data/Huawei_AQU4519R1V06.txt",
"data/Huawei_ASI4518R14v06.txt"
];

let antennas = {};

window.onload = init;


async function init(){

for(let file of antennaFiles){

let text = await fetch(file).then(r=>r.text());

parseAntenna(text);

}

populateAntennaList();

}


function parseAntenna(text){

let lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l);

let antennaName = lines[0];

let i = 1;

antennas[antennaName] = {};


while(i < lines.length){

let band = lines[i++];

i++;

let az = [];

for(let k=0;k<360;k++){

let v = parseFloat(lines[i++].replace(",","."));

az.push(-v);

}

i++;

let el = [];

for(let k=0;k<360;k++){

let v = parseFloat(lines[i++].replace(",","."));

el.push(-v);

}

antennas[antennaName][band] = {az,el};

}

}


function populateAntennaList(){

let select = document.getElementById("antennaSelect");

for(let a in antennas){

let opt = document.createElement("option");

opt.value = a;

opt.text = a;

select.appendChild(opt);

}

select.onchange = populateBands;

populateBands();

}


function populateBands(){

let antenna = document.getElementById("antennaSelect").value;

let select = document.getElementById("bandSelect");

select.innerHTML = "";

for(let band in antennas[antenna]){

let opt = document.createElement("option");

opt.value = band;

opt.text = band;

select.appendChild(opt);

}

}


function interpolate(arr,angle){

angle = ((angle % 360)+360)%360;

let a0 = Math.floor(angle);

let a1 = (a0+1)%360;

let t = angle-a0;

return arr[a0]*(1-t)+arr[a1]*t;

}


function calculate(){

let antenna = antennaSelect.value;

let band = bandSelect.value;

let az = parseFloat(azimuthInput.value.replace(",","."));

let el = parseFloat(elevationInput.value.replace(",","."));

let data = antennas[antenna][band];

let azAtt = interpolate(data.az,az);

let elAtt = interpolate(data.el,el);

azResult.textContent = azAtt.toFixed(2)+" dB";

elResult.textContent = elAtt.toFixed(2)+" dB";

}


function clearAngles(){

azimuthInput.value="";

elevationInput.value="";

}


function clearAll(){

clearAngles();

azResult.textContent="";

elResult.textContent="";

}


function copyAz(){

navigator.clipboard.writeText(azResult.textContent);

}


function copyEl(){

navigator.clipboard.writeText(elResult.textContent);

}
