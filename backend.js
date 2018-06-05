/* Set variable */
// menggunakan const agar variable hanya dapat di read only, sehingga tidak dapat dilakukan reassign value
const m = require('moment'); // mengimport modules dari 3rd party
const repo = require('repository'); // mengimport modules dari 3rd party
const getCol = repo.getDoctorScheduleMongoCollection(); // simpan function ke dalam variable untuk di gunakan nanti
const clinicIds = [];
// memberikan default value pada queryDate, sehingga tidak perlu melakukan assign value pada saat if
const queryDate = {
  $gte: m().locale('id').format('YYYY-MM-DD') // mendapatkan waktu dari module momentjs menggunakan lokalisasi Indonesia dengan contoh format 1997-04-09
};
const queryEndTime = {
  $gte: m().format('HH:mm') // mendapatkan waktu dari module momentjs, karena hanya mengambil waktu maka tidak perlu menggunakan lokalisasi
};

// let variable di bawah ini dapat dilakukan reassign valuenya
let limit = 1;
let skip = 0;
/* End of Set Variable */

if (query.date) {
  queryDate = query.date;
  if (query.page) {
    limit = 10;
    skip = 10 * (query.page - 1)
  }
}

/* 
  Function ini berfungsi untuk memproses data.
  Fungsi pertama dan kedua di eksekusi secara paralel, dan kernel akan menunggu hasil dari kedua func tsb. 
  Apabila semua func selesai di eksekusi maka akan mengubah value dari x.doctors menjadi hasil dari promise.
  Setelah itu eksekusi setFinalResult yang nanti akan di lempar ke setresult dengan parameter yaitu x dan hasil dari eksekusi func dealwithhealthcenter dengan parameter data dari promise.

  note: hasil dari promise all menjadi array
*/
function processData(r) {
  const x = r; // reassign x dengan r, sehingga r dapat di hapus dari memory oleh garbage collector
  Promise.all([
    dealWithDoctor(x),
    dealWithClinic(x)
  ]).then((data) => {
    x.doctors = data[0];
    setResult(
      setFinalResult(
        x,
        dealWithHealthCenter(data[1])
      )
    );
  });
}

function dealWithHealthCenter(clinics) {
  const healthCentersArray = [];

  if (!query.date) {
    clinics.forEach((val) => {
      val.healthCenters.forEach((v) => {
        healthCentersArray.push(v); // menambahkan element pada array healthCentersArray
      });
    });
  }

  // melakukan iterasi serta filter pada suatu array berdasarkan apabila val.id tidak null dan tidak false
  // sehingga tidak perlu melakukan !this[value.id] && (this[value.id] = true)
  return healthCentersArray.filter((val) => {
    return val.id;
  }, Object.create(null)); // callback untuk membuat object dari hasil filter
}

function dealWithClinic(r) {
  return new Promise((resolve, reject) => {
    try {
      let clinics = [];
    
      if (query.date) {
        clinicIds = r.map((val) => {
          return val.clinicId;
        });
      }
    
      clinics = getClinic(clinicIds); // eksekusi getClinic, nodejs akan menunggu hingga proses ini selesai

      clinics.forEach((val) => {
        // jika nilai _id sama dalam hal tipe dan valuenya dengan clinicId
        if (val._id === value.clinicId) {
          value.healthCenters.forEach((v) => {
            value.healthCenterId = v.id; // set key healthcenterId sesuai dengan v.id
            value.healthCenter = v; // set healthCenter dengan element v (asumsi {name: 'harriz', id: 1})
          });
        }
      });
    
      resolve(clinics);
    } catch(err) {
      reject(err);
    }
  });
}

function dealWithDoctor(r) {
  return new Promise((resolve, reject) => {
    try {
      r.forEach((val) => {
        if (!val.doctors) { // jika value.doctors tidak ada atau false maka akan berhenti eksekusinya
          return cancel(err);
        }
    
        val.doctors.forEach((el) => { // iterasi
          // jika terdapat key active, bookingsAvailable, isOnline dan value mereka true maka key booking set true
          // && pada setiap variable berarti semua variable harus bernilai true 
          if (el.active && el.bookingsAvailable && el.isOnline) {
            el.booking = true;
          }
        });
      });

      resolve(r.doctors);
    } catch (err) {
      reject(new Error('error'));
    }
  });
}

function setFinalResult(schedules, healthCenters) {
  let finalResult = {};

  if (query.date) {
    // membandingkan antara element pertama pada array dengan element selanjutnya
    finalResult = schedules.reduce((r, currentVal) => {
      // apabila element r tidak memiliki huruf atau element sesuai dengan currentVal id
      if (r.indexOf(currentVal.healthCenter.id) === -1) { 
        r.push(currentVal.healthCenter.id); // menambah element ke r
      }

      return r; // mengembalikan hasil r
    }, []) // empty array merupakan element pertama bagi reduce
    .map((healthCenterId) => { // mapping, iterasi pada masing masing element
      return schedules.filter((el) => {
        // mengembalikan hanya array apabila healthcenter.id tipe data dan valuenya sama dengan healthcenterid
        return el.healthCenter.id === healthCenterId;
      }).map((el) => { // mapping, iterasi pada masing masing element
        return el;
      })
    }).concatAll(); 
  } else {
    // init variable dengan default value
    const s = schedules.length > 0 ? schedules[0] : null;
    const pLoc = healthCenters.length > 0 ? healthCenters : [];

    finalResult = {
      schedule: s,
      practiceLocations: pLoc
    };
  }

  return finalResult;
}

// eksekusi function getDoctorScheduleMongoCollection
getCol.then((c) => {
  /* Definisi variable dengan default value */
  const doctorId = query.doctorId;
  const date = queryDate;
  const endTime = queryEndTime;

  if (!query.date) {
    /* 
      * Melakukan distinct (menyatukan hasil yang sama) berdasarkan clinicId
      * Serta melakukan spesifikasi pencarian berdasarkan doctorId
      * Menggunakan ecmascript standar jadi tidak perlu memberikan key pada second parameter
      * Async callback sehingga menunggu hasil dari res
      * Eksekusi terhenti apabila error terjadi
    */
    c.distinct('clinicId', {
      doctorId
    }, async (err, res) => {
      if (err) {
        return cancel(err);
      }

      clinicIds = await res;
    });
  }

  /* 
    Mencari data berdasarkan doctorId, date dan endTime sebanyak variable limit dan offset dari variable skip serta melakukan join dari collection doctor berdasarkan doctorId. Hasilnya di sort berdasarkan date dan endTime.
  */
  c.aggregate([
    {
      $match: {
        doctorId,
        date,
        endTime
      }
    },
    {
      $lookup: {
        from: 'doctor',
        localField: 'doctorId',
        foreignField: '_id',
        as: 'doctors'
      },
    },
    {
      $sort: {
        date: 1,
        endTime: 1
      }
    },
    {
      $limit: limit
    },
    {
      $skip: skip
    }
  ], async (err, res) => {
    /* Error Handling, sehingga tidak melanjutkan eksekusi saat terjadi error */
    if (err) {
      return cancel(err);
    }

    /* Iterasi dari suatu array */
    res.forEach((value) => {
      value.id = value._id; // reassign value id dari _id
      delete value._id; // menghapus key _id
      value.booking = false; // set default value booking ke false
    });

    processData(res);
  });
});

function getClinic(id) {
  // asumsinya ada try and catch di dalam function getHealthCenterClinicCollection
  return repo.getHealthCenterClinicCollection().then(function (collection) {
    // melakukan pencarian data di database
    collection.aggregate([
      { '$match': { '_id': { '$in': id } } },
      { $lookup: { from: 'health-center', localField: 'healthCenter', foreignField: '_id', as: 'healthCenters' } }
    ], function (errors, result) {
      if (errors) return cancel(errors) // terminate & return errors

      result.forEach((item) => {
        item.healthCenters.map(function (value, index) {
          // redefined output collection
          let arrKey = ['name', 'description', 'type', 'telephone', 'addressDetail', '_id'];
          // iterasi dari healthcenters value key
          Object.keys(value).map(function (key) {
            // menghapus value dari healthcenters apabila tidak ditemukan key sesuai dengan array
            if (!arrKey.includes(key)) delete value[key];
            value.id = value._id;
          });

          delete value._id;

          return value;
        });
      });

      return result;
    });
  });
}

// mendifinisikan fungsi baru pada array
Array.prototype.concatAll = function () {
  var results = []
  this.forEach(function (subArray) {
    subArray.forEach(function (subArrayValue) {
      results.push(subArrayValue)
    })
  })
  return results
}