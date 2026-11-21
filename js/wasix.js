const Wasix = {

    tty_get(tty_state) {

	console.log("Wasix: tty_get "+tty_state);

	let fd = 1; // stdout

	let stdout_is_tty = 1;
	let stdin_is_tty = 1;

	let echo = 1;
	let line_buffered = 1;
	let line_feeds = 0;
	
	let do_TIOCGWINSZ = () => {
	    
	    let buf_size = 128;

	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 14; // IOCTL

	    let pid = Syscalls.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = Syscalls.fd_table[fd].remote_fd;
	    
	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    let op = 0x5413; // TIOCGWINSZ
	    
	    // op
	    buf2[16] = op & 0xff;
	    buf2[17] = (op >> 8) & 0xff;
	    buf2[18] = (op >> 16) & 0xff;
	    buf2[19] = (op >> 24) & 0xff;

	    let len = 0;

	    buf2[20] = len & 0xff;
	    buf2[21] = (len >> 8) & 0xff;
	    buf2[22] = (len >> 16) & 0xff;
	    buf2[23] = (len >> 24) & 0xff;
	    
	    let msg = {
		
		from: Syscalls.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = Syscalls.get_channel(Syscalls.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	if ( (fd in Syscalls.fd_table) && (Syscalls.fd_table[fd]) ) {

	    do_TIOCGWINSZ();
	}
	else {

	    if (Syscalls.is_open(fd) >= 0) {

		do_TIOCGWINSZ();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(Syscalls.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+Syscalls.sharedEventArray[0]);

	Atomics.store(Syscalls.sharedEventArray, 0, 0);

	console.log(Syscalls.sharedDataArray);

	function handleTIOCGWINSZResponse(buf) {

	    console.log("handleTIOCGWINSZResponse");

	    if (buf[0] == (14|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		console.log("errno="+_errno);

		if (!_errno) {

		    let row = buf[24] | (buf[25] << 8);
		    let col = buf[26] | (buf[27] << 8);

		    console.log("row="+row+", col="+col);

		    // cols
		    HEAPU8[tty_state] = buf[26];
		    HEAPU8[tty_state+1] = buf[27];
		    HEAPU8[tty_state+2] = 0;
		    HEAPU8[tty_state+3] = 0;

		    // rows
		    HEAPU8[tty_state+4] = buf[24];
		    HEAPU8[tty_state+5] = buf[25];
		    HEAPU8[tty_state+6] = 0;
		    HEAPU8[tty_state+7] = 0;

		    // width
		    HEAPU8[tty_state+8] = 0;
		    HEAPU8[tty_state+9] = 0;
		    HEAPU8[tty_state+10] = 0;
		    HEAPU8[tty_state+11] = 0;

		    // height
		    HEAPU8[tty_state+12] = 0;
		    HEAPU8[tty_state+13] = 0;
		    HEAPU8[tty_state+14] = 0;
		    HEAPU8[tty_state+15] = 0;

		}
		
		return -_errno;
	    }
	    
	    return -1;
	}

	let res = handleTIOCGWINSZResponse(Syscalls.sharedDataArray);

	if (res) {

	    stdout_is_tty = 0;
	}

	HEAPU8[tty_state+16+1] = stdout_is_tty;
	HEAPU8[tty_state+16+2] = stdout_is_tty; // for now, stderr = stdout 

	let do_TCGETS = () => {
	    
	    let buf_size = 128;

	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 14; // IOCTL

	    let pid = Syscalls.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = Syscalls.fd_table[fd].remote_fd;
	    
	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    let op = 0x5401; // TCGETS
	    
	    // op
	    buf2[16] = op & 0xff;
	    buf2[17] = (op >> 8) & 0xff;
	    buf2[18] = (op >> 16) & 0xff;
	    buf2[19] = (op >> 24) & 0xff;

	    let len = 0;

	    buf2[20] = len & 0xff;
	    buf2[21] = (len >> 8) & 0xff;
	    buf2[22] = (len >> 16) & 0xff;
	    buf2[23] = (len >> 24) & 0xff;
	    
	    let msg = {
		
		from: Syscalls.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = Syscalls.get_channel(Syscalls.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	fd = 0; // stdin

	if ( (fd in Syscalls.fd_table) && (Syscalls.fd_table[fd]) ) {

	    do_TCGETS();
	}
	else {

	    if (Syscalls.is_open(fd) >= 0) {

		do_TCGETS();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(Syscalls.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+Syscalls.sharedEventArray[0]);

	Atomics.store(Syscalls.sharedEventArray, 0, 0);

	console.log(Syscalls.sharedDataArray);

	function handleTCGETSResponse(buf) {

	    console.log("handleTCGETSResponse");

	    if (buf[0] == (14|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		console.log("errno="+_errno);

		if (!_errno) {

		    let iflag = buf[24] | (buf[24+1] << 8) | (buf[24+2] << 16) |  (buf[24+3] << 24);
		    let lflag = buf[24+3*4] | (buf[24+3*4+1] << 8) | (buf[24+3*4+2] << 16) |  (buf[24+3*4+3] << 24);

		    echo = lflag & 0x08; // ECHO
		    line_buffered = lflag & 0x02; // ICANON

		    line_feeds = iflag & 0x0100; // ICRNL
		}
		
		return -_errno;
	    }
	    
	    return -1;
	}

	res = handleTCGETSResponse(Syscalls.sharedDataArray);

	if (res) {

	    stdin_is_tty = 0;
	}

	HEAPU8[tty_state+16] = stdin_is_tty;
	
	HEAPU8[tty_state+16+3] = echo;
	HEAPU8[tty_state+16+4] = line_buffered;
	HEAPU8[tty_state+16+5] = line_feeds;
	
	return 0;
    },

    tty_set(tty_state) {

	console.log("Wasix: tty_set "+tty_state);

	let fd = 0; // stdin

	let do_TCGETS = () => {
	    
	    let buf_size = 128;

	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 14; // IOCTL

	    let pid = Syscalls.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = Syscalls.fd_table[fd].remote_fd;
	    
	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    let op = 0x5401; // TCGETS
	    
	    // op
	    buf2[16] = op & 0xff;
	    buf2[17] = (op >> 8) & 0xff;
	    buf2[18] = (op >> 16) & 0xff;
	    buf2[19] = (op >> 24) & 0xff;

	    let len = 0;

	    buf2[20] = len & 0xff;
	    buf2[21] = (len >> 8) & 0xff;
	    buf2[22] = (len >> 16) & 0xff;
	    buf2[23] = (len >> 24) & 0xff;
	    
	    let msg = {
		
		from: Syscalls.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = Syscalls.get_channel(Syscalls.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	if ( (fd in Syscalls.fd_table) && (Syscalls.fd_table[fd]) ) {

	    do_TCGETS();
	}
	else {

	    if (Syscalls.is_open(fd) >= 0) {

		do_TCGETS();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(Syscalls.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+Syscalls.sharedEventArray[0]);

	Atomics.store(Syscalls.sharedEventArray, 0, 0);

	console.log(Syscalls.sharedDataArray);

	let tcbuf = new Uint8Array(60);

	function handleTCGETSResponse(buf) {

	    console.log("handleTCGETSResponse");

	    if (buf[0] == (14|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		console.log("errno="+_errno);

		if (!_errno) {

		    tcbuf.set(buf.subarray(24, 24+60));
		}
		
		return -_errno;
	    }
	    
	    return -1;
	}

	let res = handleTCGETSResponse(Syscalls.sharedDataArray);

	if (res) {
	    
	    return res;
	}

	let echo = HEAPU8[tty_state+16+3];
	let line_buffered = HEAPU8[tty_state+16+4];
	let line_feeds = HEAPU8[tty_state+16+5];

	if (echo) {

	    tcbuf[3*4] = tcbuf[3*4] | 0x08;
	}
	else {

	    tcbuf[3*4] = tcbuf[3*4] & 0xF7;
	}

	if (line_buffered) {

	    tcbuf[3*4] = tcbuf[3*4] | 0x02;
	}
	else {
	    
	    tcbuf[3*4] = tcbuf[3*4] & 0xFD;
	}

	if (line_feeds) {

	    tcbuf[1] = tcbuf[1] | 0x01;
	}
	else {

	    tcbuf[1] = tcbuf[1] & 0xFE;
	}

	let do_TCSETS = () => {
	    
	    let buf_size = 128;

	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 14; // IOCTL

	    let pid = Syscalls.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = Syscalls.fd_table[fd].remote_fd;
	    
	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    let op = 0x5402; // TCSETS
	    
	    // op
	    buf2[16] = op & 0xff;
	    buf2[17] = (op >> 8) & 0xff;
	    buf2[18] = (op >> 16) & 0xff;
	    buf2[19] = (op >> 24) & 0xff;

	    let len = 0;

	    buf2[20] = len & 0xff;
	    buf2[21] = (len >> 8) & 0xff;
	    buf2[22] = (len >> 16) & 0xff;
	    buf2[23] = (len >> 24) & 0xff;

	    buf2.set(tcbuf, 24);
	    
	    let msg = {
		
		from: Syscalls.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = Syscalls.get_channel(Syscalls.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	do_TCSETS();

	Atomics.wait(Syscalls.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+Syscalls.sharedEventArray[0]);

	Atomics.store(Syscalls.sharedEventArray, 0, 0);

	console.log(Syscalls.sharedDataArray);

	function handleTCSETSResponse(buf) {

	    console.log("handleTCSETSResponse");

	    if (buf[0] == (14|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		console.log("errno="+_errno);
		
		return -_errno;
	    }
	    
	    return -1;
	}

	return handleTCSETSResponse(Syscalls.sharedDataArray);

    },
}

