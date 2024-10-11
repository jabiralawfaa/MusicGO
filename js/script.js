const content = document.querySelector(".content"),
  Playimage = content.querySelector(".music-image img"),
  bgImg = document.querySelector(".bgImg"),
  musicName = content.querySelector(".music-titles .name"),
  musicArtist = content.querySelector(".music-titles .artist"),
  Audio = document.querySelector(".main-song"),
  playBtn = content.querySelector(".play-pause"),
  playBtnIcon = content.querySelector(".play-pause span"),
  prevBtn = content.querySelector("#prev"),
  nextBtn = content.querySelector("#next"),
  progressBar = content.querySelector(".progress-bar"),
  progressDetails = content.querySelector(".progress-details"),
  repeatBtn = content.querySelector("#repeat"),
  Shuffle = content.querySelector("#shuffle"),
  volumeSlider = document.getElementById("volume-slider"),
  volumeIcon = document.getElementById("volume-icon");

let index = 1;
let defaultBgVideo = bgImg.querySelector("source").src; // Simpan video default

window.addEventListener("load", () => {
  loadData(index);
  const initialVolume = volumeSlider.value / 100;
  Audio.volume = initialVolume;
  updateVolumeIcon(initialVolume);
});

function loadData(indexValue) {
  const song = songs[indexValue - 1];
  musicName.innerHTML = song.name;
  musicArtist.innerHTML = song.artist;
  Playimage.src = "images/" + song.img + ".jpg";
  Audio.src = "music/" + song.audio + ".mp3";

  // Periksa apakah lagu memiliki tag special_
  if (song.audio.startsWith("special_")) {
    bgImg.querySelector("source").src = "videos/" + song.audio + ".mp4";
  } else {
    // Kembalikan ke video latar belakang default dari index.html
    bgImg.querySelector("source").src = defaultBgVideo;
  }

  // Muat ulang video
  bgImg.load();
}

playBtn.addEventListener("click", () => {
  const isMusicPaused = content.classList.contains("paused");
  if (isMusicPaused) {
    pauseSong();
  } else {
    playSong();
  }
});

function playSong() {
  content.classList.add("paused");
  playBtnIcon.innerHTML = "pause";
  Audio.play();
  Playimage.classList.add("rotate"); // Tambahkan kelas rotate
  Playimage.classList.remove("paused"); // Hapus kelas paused jika ada
}

function pauseSong() {
  content.classList.remove("paused");
  playBtnIcon.innerHTML = "play_arrow";
  Audio.pause();
  Playimage.classList.add("paused"); // Tambahkan kelas paused
}

nextBtn.addEventListener("click", () => {
  nextSong();
});

prevBtn.addEventListener("click", () => {
  prevSong();
});

function nextSong() {
  index++;
  if (index > songs.length) {
    index = 1;
  } else {
    index = index;
  }
  loadData(index);
  playSong();
}

function prevSong() {
  index--;
  if (index <= 0) {
    index = songs.length;
  } else {
    index = index;
  }
  loadData(index);
  playSong();
}

Audio.addEventListener("timeupdate", (e) => {
  const initialTime = e.target.currentTime; // Get current music time
  const finalTime = e.target.duration; // Get music duration
  let BarWidth = (initialTime / finalTime) * 100;
  progressBar.style.width = BarWidth + "%";

  progressDetails.addEventListener("click", (e) => {
    let progressValue = progressDetails.clientWidth; // Get width of Progress Bar
    let clickedOffsetX = e.offsetX; // get offset x value
    let MusicDuration = Audio.duration; // get total music duration

    Audio.currentTime = (clickedOffsetX / progressValue) * MusicDuration;
  });

  //Timer Logic
  Audio.addEventListener("loadeddata", () => {
    let finalTimeData = content.querySelector(".final");

    //Update finalDuration
    let AudioDuration = Audio.duration;
    let finalMinutes = Math.floor(AudioDuration / 60);
    let finalSeconds = Math.floor(AudioDuration % 60);
    if (finalSeconds < 10) {
      finalSeconds = "0" + finalSeconds;
    }
    finalTimeData.innerText = finalMinutes + ":" + finalSeconds;
  });

  //Update Current Duration
  let currentTimeData = content.querySelector(".current");
  let CurrentTime = Audio.currentTime;
  let currentMinutes = Math.floor(CurrentTime / 60);
  let currentSeconds = Math.floor(CurrentTime % 60);
  if (currentSeconds < 10) {
    currentSeconds = "0" + currentSeconds;
  }
  currentTimeData.innerText = currentMinutes + ":" + currentSeconds;

  //repeat button logic
  repeatBtn.addEventListener("click", () => {
    Audio.currentTime = 0;
  });
});

//Shuffle Logic
Shuffle.addEventListener("click", () => {
  var randIndex = Math.floor(Math.random() * songs.length) + 1; // Select random betwn 1 and song array length
  loadData(randIndex);
  playSong();
});

Audio.addEventListener("ended", () => {
  index++;
  if (index > songs.length) {
    index = 1;
  }
  loadData(index);
  playSong();
});

volumeSlider.addEventListener("input", () => {
  const volume = volumeSlider.value / 100;
  Audio.volume = volume;
  updateVolumeIcon(volume);
});

function updateVolumeIcon(volume) {
  if (volume > 0.5) {
    volumeIcon.textContent = "volume_up";
  } else if (volume > 0) {
    volumeIcon.textContent = "volume_down";
  } else {
    volumeIcon.textContent = "volume_mute";
  }
}

// Tambahkan fungsi untuk mematikan/menghidupkan suara saat ikon volume diklik
volumeIcon.addEventListener("click", () => {
  if (Audio.volume > 0) {
    Audio.volume = 0;
    volumeSlider.value = 0;
    volumeIcon.textContent = "volume_mute";
  } else {
    const lastVolume = volumeSlider.value / 100 || 1;
    Audio.volume = lastVolume;
    volumeSlider.value = lastVolume * 100;
    updateVolumeIcon(lastVolume);
  }
});

// Tambahkan fungsi untuk menambahkan event listener ke tombol playlist
const playlistBtn = content.querySelector(".playlist");
playlistBtn.addEventListener("click", () => {
  const playlist = document.querySelector(".playlist-container");
  const isPlaylistOpen = playlist.classList.contains("show");
  if (isPlaylistOpen) {
    playlist.classList.remove("show");
  } else {
    playlist.classList.add("show");
  }
});

// Tambahkan event listener untuk menghentikan rotasi saat lagu selesai
Audio.addEventListener("ended", () => {
  Playimage.classList.remove("rotate");
  Playimage.classList.remove("paused");
});
