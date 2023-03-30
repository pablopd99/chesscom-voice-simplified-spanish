const pieceCodeToName = {
  'R': 'king',
  'D': 'queen',
  'T': 'rook',
  'A': 'bishop',
  'C': 'knight',
};

const matchSan = (san) => {
  // pattern for SAN based on this thread https://stackoverflow.com/questions/40007937/regex-help-for-chess-moves-san
  // with modifications
  const pattern = /(?:(O-O(?:-O)?)|(?:([CATDR])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=[CATDR])?))(\+)?(#)?/;
  return san.match(pattern);
}

const getMoveAudioIds = (san) => {
  const match = matchSan(san);

  let seq = [];

  // castle, either short or long
  if (match[1]) {
    seq.push(`full_move/${match[1]}`);
  }
  // piece
  if (match[2]) {
    seq.push(`piece/${pieceCodeToName[match[2]]}`);
  }
  // file and rank or pawn that is moving
  if (match[3] && match[4]) {
    seq.push(`square/${match[3]}${match[4]}`);
  } else if (match[3]) {
    seq.push(`file/${match[3]}`);
  } else if (match[4]) {
    seq.push(`rank/${match[4]}`);
  }
  // takes
  if (match[5]) {
    seq.push('move_modifier/takes');
  }
  // full destination square, mandatory except castling moves
  if (match[6] && match[7]) {
    seq.push(`square/${match[6]}${match[7]}`);
  }
  // promotion to piece
  if (match[8]) {
    const pieceCode = match[8].substring(1);
    const pieceName = pieceCodeToName[pieceCode];
    seq.push('move_modifier/equals');
    seq.push(`piece/${pieceName}`);
  }
  // check
  if (match[9]) {
    seq.push('move_modifier/check');
  }
  // mate
  if (match[10]) {
    seq.push('move_modifier/mate');
  }
  return seq;
}

const makeAudioPath = ({ basePath, identifierPath, extension }) => {
  return `${basePath}${identifierPath}.${extension}`;
}

class AudioSequence {
  constructor(paths, volume) {
    this.paths = paths;
    this.volume = volume;
    this.listeners = {};
    this.audio = null;
  }

  _playNext() {
    if (!this.paths.length) {
      if (this.listeners['ended'] && typeof this.listeners['ended'] === 'function') {
        this.listeners['ended']();
      }
    } else {
      this.audio = new Audio();
      this.audio.addEventListener('canplaythrough', () => {
        this.audio.addEventListener('ended', () => {
          chrome.runtime.sendMessage({type: 'clearPromptInteraction'})
            .catch((err) => {
              console.log("Exception while sending message 'clearPromptInteraction'", err);
            })
            .then(() => {
              this._playNext()
            });
        });
        this.audio.volume = this.volume;
        this.audio.play()
          .catch(err => {
            chrome.runtime.sendMessage({type: 'promptInteraction'})
              .catch((err) => {
                console.log("Exception while sending message 'promptInteraction'", err)
              }).then(() => {
                this._playNext();
              })
          })
      });
      this.audio.addEventListener('error', () => { this._playNext(); });
      const path = this.paths.shift();
      this.audio.src = chrome.runtime.getURL(path);
    }
  }
  play() {
    this._playNext();
  }

  pause() {
    if (this.audio !== null) {
      this.audio.pause();
    }
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }
};

class PlayQueue {
  constructor() {
    this.audios = [];
  }

  enqueue(audio, priority = 5) {
    while (this.audios.length) {
      const last = this.audios[this.audios.length-1];
      if (last.priority < priority) {
        last.audio.pause();
        this.audios.pop();
      } else {
        break;
      }
    }
    this.audios.push({
      audio,
      priority,
    });
    if (this.audios.length === 1) {
      this.deque();
    }
  }

  deque() {
    if (!this.audios.length) {
      return;
    }
    const head = this.audios[0].audio;
    head.addEventListener('ended', () => {
      this.audios.shift();
      while (this.audios.length >= 2) {
        this.audios.shift();
      }
      this.deque();
    });

    head.play();
  }

  clear() {
    this.audios = [];
  }
};


class MoveVoice {
  constructor({ volume }) {
    this._volume = volume;
    this._q = new PlayQueue();
  }

  set volume(value) {
    this._volume = value;
  }

  _playIds(ids, basePath, extension, priority = 5) {
    const audios = ids.map(id => makeAudioPath({ basePath, identifierPath: id, extension }));
    const seq = new AudioSequence(audios, this._volume);
    this._q.enqueue(seq, priority);
  }

  move({ san }) {
    const ids = getMoveAudioIds(san);
    this._playIds(ids, 'mp3/', 'mp3');
  }
};


function setVoice() {
  console.log("Starting chess.com voice commentary...");

  let voice = new MoveVoice({volume: 0.5});
  var callback = function(mutationsList) {
	  for(var mutation of mutationsList) {
		  if (mutation.addedNodes.length == 0) continue;
		  var added = mutation.addedNodes[0];
		  if (added.className == "white node selected" || added.className == "black node selected") {
			  console.log(added.textContent);
			  voice.move({san: added.textContent});
		  }
	  }
  };
  var observer = new MutationObserver(callback);
  var node = document.querySelector('.board-layout-sidebar');
  console.log(node);
  observer.observe(node, {childList: true, subtree: true});
}

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

// Delay by 1 second to let the sidebar load.
delay(1000).then(() => setVoice());

