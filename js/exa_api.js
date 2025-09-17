var exa = {};

exa.init = function() {

    this.pid = parseInt(window.frameElement.getAttribute('pid'));
    this.resmgr_bc = new BroadcastChannel("/var/resmgr.peer");
};

exa.show = function() {

    let m = {
		
	type: 7,       // show iframe
	pid: this.pid
    };
    
    window.parent.postMessage(m);
};

exa.exit = function(status) {

    let buf_size = 20;
    
    let buf2 = new Uint8Array(buf_size);

    buf2[0] = 38; // EXIT

    // pid
    buf2[4] = this.pid & 0xff;
    buf2[5] = (this.pid >> 8) & 0xff;
    buf2[6] = (this.pid >> 16) & 0xff;
    buf2[7] = (this.pid >> 24) & 0xff;

    // status
    buf2[12] = status & 0xff;
    buf2[13] = (status >> 8) & 0xff;
    buf2[14] = (status >> 16) & 0xff;
    buf2[15] = (status >> 24) & 0xff;
    
    let msg = {
	
	from: "channel.process."+this.pid,
	buf: buf2,
	len: buf_size
    };

    this.resmgr_bc.postMessage(msg);
};

exa.minimmize = function() {

    let m = {
	
	type: 12, // minimize
	pid: this.pid

    };
    
    window.parent.postMessage(m);
};

exa.axel = function() {

    let m = {
	
	type: 14, // minimize all frames
	pid: this.pid

    };
    
    window.parent.postMessage(m);
};

exa.args_env = function() {

    return new Promise((resolve, reject) => {

	// Send EXEC to resmgr

	let buf_size = 1256;

	let buf = new Uint8Array(buf_size);

	buf[0] = 8; // EXECVE
	
	// pid
	buf[4] = this.pid & 0xff;
	buf[5] = (this.pid >> 8) & 0xff;
	buf[6] = (this.pid >> 16) & 0xff;
	buf[7] = (this.pid >> 24) & 0xff;

	// errno
	buf[8] = 0;
	buf[9] = 0;
	buf[10] = 0;
	buf[11] = 0;
	
	// size
	buf[12] = 0xff;
	buf[13] = 0xff;
	buf[14] = 0xff;
	buf[15] = 0xff;

	let rcv_bc = new BroadcastChannel("channel.process."+this.pid);

	rcv_bc.onmessage = (messageEvent) => {

	    let msg2 = messageEvent.data;

	    if (msg2.buf[0] == (8|0x80)) {

		rcv_bc.close();

		this.args = [];

		let args_size = msg2.buf[12] | (msg2.buf[13] << 8) | (msg2.buf[14] << 16) |  (msg2.buf[15] << 24);

		//console.log(args_size);

		td = new TextDecoder("utf-8");

		let i = 16;

		for (; i < (16+args_size); ) {

		    let j = 0;

		    for (; msg2.buf[i+j]; j++) ;

		    let a = msg2.buf.slice(i,i+j);

		    this.args.push(td.decode(a));

		    i += j+1;
		}

		this.env_count = msg2.buf[i] | (msg2.buf[i+1] << 8) | (msg2.buf[i+2] << 16) |  (msg2.buf[i+3] << 24);

		this.env_size = msg2.buf[i+4] | (msg2.buf[i+5] << 8) | (msg2.buf[i+6] << 16) |  (msg2.buf[i+7] << 24);

		this.env = msg2.buf.slice(i+8,i+8+this.env_size);

		console.log(this.env_count);
		console.log(this.env_size);

		console.log(this.env);	

		/*Module['env'] = {

			count: env_count,
			size: env_size,
			buf : msg2.buf.slice(i+8,i+8+env_size)
		    };*/

		resolve();
	    }
	}

	let msg = {
	    
	    from: rcv_bc.name,
	    buf: buf,
	    len: buf_size
	};

	this.resmgr_bc.postMessage(msg);
    });
};

exa.IsOpen = function(fd) {

    return new Promise((resolve, reject) => {

	let buf_size = 20;
	
	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 26; // IS_OPEN

	// pid
	buf2[4] = this.pid & 0xff;
	buf2[5] = (this.pid >> 8) & 0xff;
	buf2[6] = (this.pid >> 16) & 0xff;
	buf2[7] = (this.pid >> 24) & 0xff;

	// errno
	buf2[8] = 0x0;
	buf2[9] = 0x0;
	buf2[10] = 0x0;
	buf2[11] = 0x0;

	buf2[12] = fd & 0xff;
	buf2[13] = (fd >> 8) & 0xff;
	buf2[14] = (fd >> 16) & 0xff;
	buf2[15] = (fd >> 24) & 0xff;

	let rcv_bc = new BroadcastChannel("channel.process."+this.pid);

	rcv_bc.onmessage = (messageEvent) => {

	    //console.log(messageEvent);

	    let msg2 = messageEvent.data;

	    if (msg2.buf[0] == (26|0x80)) {

		rcv_bc.close();

		let _errno = msg2.buf[8] | (msg2.buf[9] << 8) | (msg2.buf[10] << 16) |  (msg2.buf[11] << 24);

		//console.log("File opened: "+_errno);

		if (_errno == 0) {

		    let remote_fd = msg2.buf[16] | (msg2.buf[17] << 8) | (msg2.buf[18] << 16) |  (msg2.buf[19] << 24);
		    let type = msg2.buf[20];
		    let major = msg2.buf[22] | (msg2.buf[23] << 8);
		    //let peer = UTF8ArrayToString(msg2.buf, 24, 108);

		    let peer = "";
		    let i = 0;

		    while (msg2.buf[24+i]) {

			peer += String.fromCharCode(msg2.buf[24+i]);
			i += 1;
		    }

		    resolve([remote_fd, peer]);
		}
		else {

		    reject();
		}
	    } 
	};

	let msg = {
		
	    from: rcv_bc.name,
	    buf: buf2,
	    len: buf_size
	};
	
	this.resmgr_bc.postMessage(msg);
	
    });
};

exa.open = function(path, flags, mode) {

    return new Promise((resolve, reject) => {

	let buf_size = 1256;
	
	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 11; // OPEN

	// pid
	buf2[4] = this.pid & 0xff;
	buf2[5] = (this.pid >> 8) & 0xff;
	buf2[6] = (this.pid >> 16) & 0xff;
	buf2[7] = (this.pid >> 24) & 0xff;

	// errno
	buf2[8] = 0x0;
	buf2[9] = 0x0;
	buf2[10] = 0x0;
	buf2[11] = 0x0;

	const dirfd = -100; //AT_FDCWD

	// dirfd (fd for return)
	buf2[12] = dirfd & 0xff;
	buf2[13] = (dirfd >> 8) & 0xff;
	buf2[14] = (dirfd >> 16) & 0xff;
	buf2[15] = (dirfd >> 24) & 0xff;

	// remote fd

	buf2[16] = 0x0;
	buf2[17] = 0x0;
	buf2[18] = 0x0;
	buf2[19] = 0x0;

	// flags
	buf2[20] = flags & 0xff;
	buf2[21] = (flags >> 8) & 0xff;
	buf2[22] = (flags >> 16) & 0xff;
	buf2[23] = (flags >> 24) & 0xff;
	
	// mode
	buf2[24] = mode & 0xff;
	buf2[25] = (mode >> 8) & 0xff;

	// pathname
	let path_len = path.length+1;

	let i = 0;

	while (i < path.length) {

	    buf2[140+i] = path.charCodeAt(i);

	    i += 1;
	}

	buf2[140+i] = 0;

	let rcv_bc = new BroadcastChannel("channel.process."+this.pid);

	rcv_bc.onmessage = (messageEvent) => {

	    //console.log(messageEvent);

	    let msg2 = messageEvent.data;

	    if (msg2.buf[0] == (11|0x80)) {

		rcv_bc.close();

		let _errno = msg2.buf[8] | (msg2.buf[9] << 8) | (msg2.buf[10] << 16) |  (msg2.buf[11] << 24);

		//console.log("File opened: "+_errno);

		if (_errno == 0) {

		    let fd = msg2.buf[12] | (msg2.buf[13] << 8) | (msg2.buf[14] << 16) |  (msg2.buf[15] << 24);
		    let remote_fd = msg2.buf[16] | (msg2.buf[17] << 8) | (msg2.buf[18] << 16) |  (msg2.buf[19] << 24);
		    let flags = msg2.buf[20] | (msg2.buf[21] << 8) | (msg2.buf[22] << 16) |  (msg2.buf[23] << 24);
		    let mode = msg2.buf[24] | (msg2.buf[25] << 8);
		    let type = msg2.buf[26];
		    let major = msg2.buf[28] | (msg2.buf[29] << 8);
		    let minor = msg2.buf[30] | (msg2.buf[31] << 8);
		    //let peer = UTF8ArrayToString(msg2.buf, 32, 108);

		    let peer = "";
		    let i = 0;

		    while (msg2.buf[32+i]) {

			peer += String.fromCharCode(msg2.buf[32+i]);
			i += 1;
		    }

		    resolve([fd, remote_fd, peer]);
		}
		else {

		    reject();
		}
	    } 
	};

	let msg = {
		
	    from: rcv_bc.name,
	    buf: buf2,
	    len: buf_size
	};
	
	this.resmgr_bc.postMessage(msg);
	
    });
};

exa.close = function(fd) {

    return new Promise((resolve, reject) => {

	let buf_size = 16;
		
	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 15; // CLOSE
	
	// pid
	buf2[4] = this.pid & 0xff;
	buf2[5] = (this.pid >> 8) & 0xff;
	buf2[6] = (this.pid >> 16) & 0xff;
	buf2[7] = (this.pid >> 24) & 0xff;

	// fd
	buf2[12] = fd & 0xff;
	buf2[13] = (fd >> 8) & 0xff;
	buf2[14] = (fd >> 16) & 0xff;
	buf2[15] = (fd >> 24) & 0xff;

	let rcv_bc = new BroadcastChannel("channel.process."+this.pid);

	rcv_bc.onmessage = (messageEvent) => {

	    let msg2 = messageEvent.data;

	    if (msg2.buf[0] == (15|0x80)) {

		rcv_bc.close();

		let _errno = msg2.buf[8] | (msg2.buf[9] << 8) | (msg2.buf[10] << 16) |  (msg2.buf[11] << 24);

		if (!_errno) {
		    
		    resolve();
		}
		else {
		    reject();
		}
	    }		  
	};

	let msg = {

	    from: rcv_bc.name,
	    buf: buf2,
	    len: buf_size
	};

	this.resmgr_bc.postMessage(msg);
    });
};

exa.read = function(remote_fd, peer) {

    return new Promise((resolve, reject) => {

	console.log("--> File read "+remote_fd+", "+peer);

	// read all the file
	let len = 0x10000000; // 256MB instead of 0x7fffffff is too big: I do not know why netfs allocates all the memory. To be investigated
		
	let buf_size = 20;

	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 12; // READ

	// pid
	buf2[4] = this.pid & 0xff;
	buf2[5] = (this.pid >> 8) & 0xff;
	buf2[6] = (this.pid >> 16) & 0xff;
	buf2[7] = (this.pid >> 24) & 0xff;
	
	// remote_fd
	buf2[12] = remote_fd & 0xff;
	buf2[13] = (remote_fd >> 8) & 0xff;
	buf2[14] = (remote_fd >> 16) & 0xff;
	buf2[15] = (remote_fd >> 24) & 0xff;

	// len
	buf2[16] = len & 0xff;
	buf2[17] = (len >> 8) & 0xff;
	buf2[18] = (len >> 16) & 0xff;
	buf2[19] = (len >> 24) & 0xff;

	let rcv_bc = new BroadcastChannel("channel.process."+this.pid);

	rcv_bc.onmessage = (messageEvent) => {

	    let msg2 = messageEvent.data;

	    if (msg2.buf[0] == (12|0x80)) {

		rcv_bc.close();

		let _errno = msg2.buf[8] | (msg2.buf[9] << 8) | (msg2.buf[10] << 16) |  (msg2.buf[11] << 24);

		console.log("File read: "+_errno);

		if (!_errno) {

		    let bytes_read = msg2.buf[16] | (msg2.buf[17] << 8) | (msg2.buf[18] << 16) |  (msg2.buf[19] << 24);

		    console.log("File size="+bytes_read);

		    resolve(msg2.buf.slice(20, 20+bytes_read));
		}
		else {

		    reject();
		}
	    }
	};

	let msg = {
		    
	    from: rcv_bc.name,
	    buf: buf2,
	    len: buf_size
	};

	let driver_bc = new BroadcastChannel(peer);
	
	driver_bc.postMessage(msg);
    });
};

exa.write = function(remote_fd, peer, file) {

    return new Promise((resolve, reject) => {

	console.log("--> File write "+remote_fd+", "+peer);

	const len = file.length;

	let buf_size = 20+len;

	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 13; // WRITE

	// pid
	buf2[4] = this.pid & 0xff;
	buf2[5] = (this.pid >> 8) & 0xff;
	buf2[6] = (this.pid >> 16) & 0xff;
	buf2[7] = (this.pid >> 24) & 0xff;

	// remote_fd
	buf2[12] = remote_fd & 0xff;
	buf2[13] = (remote_fd >> 8) & 0xff;
	buf2[14] = (remote_fd >> 16) & 0xff;
	buf2[15] = (remote_fd >> 24) & 0xff;

	// len
	buf2[16] = len & 0xff;
	buf2[17] = (len >> 8) & 0xff;
	buf2[18] = (len >> 16) & 0xff;
	buf2[19] = (len >> 24) & 0xff;

	for (let i=0; i < len; i+= 1)
	    buf2[20+i] = file.charCodeAt(i);;

	let rcv_bc = new BroadcastChannel("channel.process."+this.pid);

	rcv_bc.onmessage = (messageEvent) => {
	    
	    let msg2 = messageEvent.data;

	    if (msg2.buf[0] == (13|0x80)) {

		rcv_bc.close();

		let _errno = msg2.buf[8] | (msg2.buf[9] << 8) | (msg2.buf[10] << 16) |  (msg2.buf[11] << 24);

		console.log("File written: "+_errno);

		if (!_errno) {
		    
		    let bytes_written = msg2.buf[16] | (msg2.buf[17] << 8) | (msg2.buf[18] << 16) |  (msg2.buf[19] << 24);
		    
		    console.log("Nb bytes written: "+bytes_written);

		    resolve(bytes_written);
		}
		else {

		    reject();
		}
	    }
	};

	let msg = {

	    from: rcv_bc.name,
	    buf: buf2,
	    len: buf_size
	};

	let driver_bc = new BroadcastChannel(peer);
	
	driver_bc.postMessage(msg);
    });
};
