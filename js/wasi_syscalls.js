const Syscalls = {

    pid: -1,

    fd_table: {},

    init(pid, sharedEventArray, sharedDataArray) {

	this.pid = pid;
	this.sharedEventArray = sharedEventArray;
	this.sharedDataArray = sharedDataArray;
	
	this.rcv_bc_channel_name = "channel.process."+this.pid;
	this.resmgr_bc_channel = new BroadcastChannel("/var/resmgr.peer");

	console.log(this);
    },

    is_open(fd) {

	console.log("Syscalls.is_open: fd="+fd);

	let buf_size = 20;

	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 26; // IS_OPEN

	let pid = this.pid;

	// pid
	buf2[4] = pid & 0xff;
	buf2[5] = (pid >> 8) & 0xff;
	buf2[6] = (pid >> 16) & 0xff;
	buf2[7] = (pid >> 24) & 0xff;

	// fd
	buf2[12] = fd & 0xff;
	buf2[13] = (fd >> 8) & 0xff;
	buf2[14] = (fd >> 16) & 0xff;
	buf2[15] = (fd >> 24) & 0xff;

	function handleIsOpenResponse(buf, fd_table) {

	    if (buf[0] == (26|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (!_errno) {

		    let remote_fd = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);
		    let type = buf[20];
		    let major = buf[22] | (buf[23] << 8);
		    let peer = Utf8ArrayToStr(buf.subarray(24, 24+108));			    
		    let desc = {

			fd: fd,
			remote_fd: remote_fd,
			peer: peer,
			type: type,
			major: major,
			
			error: null, // Used in getsockopt for SOL_SOCKET/SO_ERROR test
			peers: {},
			pending: [],
			recv_queue: [],
			name: null,
			bc: null,
		    };

		    fd_table[fd] = desc;

		    return 0;
		}
	    }

	    return -1;
	}

	let msg = {
	    
	    from: this.rcv_bc_channel_name,
	    buf: buf2,
	    len: buf_size
	};

	let bc = this.resmgr_bc_channel;

	console.log(bc);

	Atomics.store(this.sharedEventArray, 0, 0); // Listen main thread events
	
	bc.postMessage(msg);

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	if (handleIsOpenResponse(this.sharedDataArray, this.fd_table) < 0) {

	    return -1;
	}

	return 0;
    },

    openat(dirfd, path, len, flags, mode) {

	console.log("Syscalls.openat: dirfd="+dirfd+", len="+len+", flags="+flags+", mode="+mode);

	let pid = this.pid;
	
	let buf_size = 1256;
	
	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 11; // OPEN

	// pid
	buf2[4] = pid & 0xff;
	buf2[5] = (pid >> 8) & 0xff;
	buf2[6] = (pid >> 16) & 0xff;
	buf2[7] = (pid >> 24) & 0xff;

	// errno
	buf2[8] = 0x0;
	buf2[9] = 0x0;
	buf2[10] = 0x0;
	buf2[11] = 0x0;

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

	if (typeof path == "string") {

	    for (let i = 0; i < len; i++) {

		buf2[140+i]  = path.charCodeAt(i);
	    }
	}
	else {

	    buf2.set(HEAPU8.subarray(path, path+len), 140);
	}

	buf2[140+len] = 0; // add trailing zero

	let msg = {

	    from: this.rcv_bc_channel_name,
	    buf: buf2,
	    len: buf_size
	};
	
	let bc = this.resmgr_bc_channel;

	console.log(bc);

	Atomics.store(this.sharedEventArray, 0, 0); // Listen main thread events
	
	bc.postMessage(msg);

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleOpenatResponse(buf, fd_table) {

	    if (buf[0] == (11|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (_errno == 0) {

		    let fd = buf[12] | (buf[13] << 8) | (buf[14] << 16) |  (buf[15] << 24);
		    let remote_fd = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);
		    let flags = buf[20] | (buf[21] << 8) | (buf[22] << 16) |  (buf[23] << 24);
		    let mode = buf[24] | (buf[25] << 8);
		    let type = buf[26];
		    let major = buf[28] | (buf[29] << 8);
		    let minor = buf[30] | (buf[31] << 8);
		    let peer = Utf8ArrayToStr(buf.subarray(32, 32+108));

		    //console.log("__syscall_openat: peer=%s fd=%d", peer, fd);

		    var desc = {

			fd: fd,
			remote_fd: remote_fd,
			flags: flags,
			mode: mode,
			peer: peer,
			type: type,
			major: major,
			minor: minor,
			
			error: null, // Used in getsockopt for SOL_SOCKET/SO_ERROR test
			peers: {},
			pending: [],
			recv_queue: [],
			name: null,
			bc: null,
		    };

		    fd_table[fd] = desc;

		    return fd;
		}
		else {

		    return -_errno;
		}
	    }

	    return -1;
	}

	const fd = handleOpenatResponse(this.sharedDataArray, this.fd_table);

	return fd;
    },

    close(fd) {

	console.log("Syscalls.close: fd="+fd);

	let do_close = () => {

	    let buf_size = 16;
	    
	    let buf2 = new Uint8Array(buf_size);

	    buf2[0] = 15; // CLOSE

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    // fd
	    buf2[12] = fd & 0xff;
	    buf2[13] = (fd >> 8) & 0xff;
	    buf2[14] = (fd >> 16) & 0xff;
	    buf2[15] = (fd >> 24) & 0xff;
	    
	    let msg = {

		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let bc = this.resmgr_bc_channel;

	    bc.postMessage(msg);
	};

	if ( (fd in this.fd_table) && (this.fd_table[fd]) ) {

	    do_close();
	}
	else {

	    if (this.is_open(fd) >= 0) {

		do_close();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleCloseResponse(buf) {

	    if (buf[0] == (15|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		return _errno;
	    }

	    return -1;
	}

	return handleCloseResponse(this.sharedDataArray);
    },

    unlinkat(dirfd, path, path_len) {

	console.log("Syscalls.unlinkat: dirfd="+dirfd);

	let pid = this.pid;
	
	let buf_size = 1256;
	
	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 50; // UNLINKAT

	// pid
	buf2[4] = pid & 0xff;
	buf2[5] = (pid >> 8) & 0xff;
	buf2[6] = (pid >> 16) & 0xff;
	buf2[7] = (pid >> 24) & 0xff;

	// errno
	buf2[8] = 0x0;
	buf2[9] = 0x0;
	buf2[10] = 0x0;
	buf2[11] = 0x0;

	// dirfd
	buf2[12] = dirfd & 0xff;
	buf2[13] = (dirfd >> 8) & 0xff;
	buf2[14] = (dirfd >> 16) & 0xff;
	buf2[15] = (dirfd >> 24) & 0xff;

	const flags = 0;

	//flags
	buf2[16] = flags & 0xff;
	buf2[17] = (flags >> 8) & 0xff;
	buf2[18] = (flags >> 16) & 0xff;
	buf2[19] = (flags >> 24) & 0xff;

	path_len++;

	buf2[20] = path_len & 0xff;
	buf2[21] = (path_len >> 8) & 0xff;
	buf2[22] = (path_len >> 16) & 0xff;
	buf2[23] = (path_len >> 24) & 0xff;
	
	buf2.set(HEAPU8.subarray(path, path+path_len-1), 24);

	buf2[24+path_len-1] = 0; // add trailing zero

	let msg = {

	    from: this.rcv_bc_channel_name,
	    buf: buf2,
	    len: buf_size
	};
	
	let bc = this.resmgr_bc_channel;

	console.log(bc);

	Atomics.store(this.sharedEventArray, 0, 0); // Listen main thread events
	
	bc.postMessage(msg);

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleUnlinkatResponse(buf, fd_table) {

	    if (buf[0] == (50|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		return -_errno;
	    }

	    return -1;
	}

	return handleUnlinkatResponse(this.sharedDataArray, this.fd_table);
    },

    mkdirat(dirfd, path, path_len) {

	console.log("Syscalls.mkdirat: dirfd="+dirfd);

	let mode = 0777;

	let pid = this.pid;

	let buf_size = 1256;
	  
	let buf2 = new Uint8Array(buf_size);
	
	buf2[0] = 65; // MKDIRAT
	
	// pid
	buf2[4] = pid & 0xff;
	buf2[5] = (pid >> 8) & 0xff;
	buf2[6] = (pid >> 16) & 0xff;
	buf2[7] = (pid >> 24) & 0xff;
	
	// errno
	buf2[8] = 0x0;
	buf2[9] = 0x0;
	buf2[10] = 0x0;
	buf2[11] = 0x0;

	buf2[12] = dirfd & 0xff;
	buf2[13] = (dirfd >> 8) & 0xff;
	buf2[14] = (dirfd >> 16) & 0xff;
	buf2[15] = (dirfd >> 24) & 0xff;

	buf2[16] = mode & 0xff;
	buf2[17] = (mode >> 8) & 0xff;
	buf2[18] = (mode >> 16) & 0xff;
	buf2[19] = (mode >> 24) & 0xff;

	path_len++;

	buf2[20] = path_len & 0xff;
	buf2[21] = (path_len >> 8) & 0xff;
	buf2[22] = (path_len >> 16) & 0xff;
	buf2[23] = (path_len >> 24) & 0xff;

	buf2.set(HEAPU8.subarray(path, path+path_len-1), 24);

	buf2[24+path_len-1] = 0; // add trailing zero

	let msg = {

	    from: this.rcv_bc_channel_name,
	    buf: buf2,
	    len: buf_size
	};
	
	let bc = this.resmgr_bc_channel;

	console.log(bc);

	Atomics.store(this.sharedEventArray, 0, 0); // Listen main thread events
	
	bc.postMessage(msg);

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleMkdiratResponse(buf, fd_table) {

	    if (buf[0] == (65|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		return -_errno;
	    }

	    return -1;
	}

	return handleMkdiratResponse(this.sharedDataArray, this.fd_table);
    },

    /*adapter_close_badfd(fd) {

	console.log("Syscalls.adapter_close_badfd");
    },
    
    */

    lseek(fd, offset, whence) {

	let do_lseek = () => {

	    let buf_size = 256;

	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 39; // SEEK

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = this.fd_table[fd].remote_fd;

	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    // offset
	    buf2[16] = offset & 0xff;
	    buf2[17] = (offset >> 8) & 0xff;
	    buf2[18] = (offset >> 16) & 0xff;
	    buf2[19] = (offset >> 24) & 0xff;

	    // whence
	    buf2[20] = whence & 0xff;
	    buf2[21] = (whence >> 8) & 0xff;
	    buf2[22] = (whence >> 16) & 0xff;
	    buf2[23] = (whence >> 24) & 0xff;
	    
	    let msg = {
		
		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	if ( (fd in this.fd_table) && (this.fd_table[fd]) ) {

	    do_lseek();
	}
	else {

	    if (this.is_open(fd) >= 0) {

		do_lseek();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleSeekResponse(buf) {

	    if (buf[0] == (39|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (!_errno) {

		    let off = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

		    return off;
		}

		return -_errno;
	    }

	    return -1;
	}

	const off = handleSeekResponse(this.sharedDataArray);

	return off;
    },

    blocking_write_and_flush(fd, buf, len, retptr) {

	console.log("--> Syscalls.blocking_write_and_flush: "+fd+", "+buf+", "+len+", "+retptr);

	let do_writev = () => {

	    console.log("-> do_writev");

	    let buf_size = 20+len;

	    let buf2 = new Uint8Array(buf_size);

	    buf2[0] = 13; // WRITE
	    
	    let pid = this.pid;

	    //console.log("writev: tid="+pid);

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = this.fd_table[fd].remote_fd;

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

	    if (buf && (len > 0)) {

		if (retptr) { // buf is an offset
		
		    buf2.set(HEAPU8.subarray(buf, buf+len), 20);
		}
		else { // buf is a buffer

		    buf2.set(buf.subarray(0, len), 20);
		}
	    }

	    let msg = {

		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	if ( (fd in this.fd_table) && (this.fd_table[fd]) ) {

	    do_writev();
	}
	else {

	    if (this.is_open(fd) >= 0) {

		do_writev();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleWriteResponse(buf) {

	    if (buf[0] == (13|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		//const bytes_written = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

		return _errno;
	    }

	    return -1;
	}

	const err = handleWriteResponse(this.sharedDataArray);

	if (retptr)
	    HEAPU8[retptr] = err;

	return err;
    },

    blocking_read(fd, count, retptr) {

	console.log("--> Syscalls.blocking_read");

	const len = Number(count);

	let do_read = () => {

	    let buf_size = 20;

	    let buf2 = new Uint8Array(buf_size);

	    buf2[0] = 12; // READ

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = this.fd_table[fd].remote_fd;

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

	    let msg = {
		
		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};
	
	if ( (fd in this.fd_table) && (this.fd_table[fd]) ) {

	    do_read();
	}
	else {

	    if (this.is_open(fd) >= 0) {

		do_read();
	    }
	    else {

		return -1;
	    }
	}
	
	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleReadResponse(buf) {

	    if (!retptr)
		return buf;

	    if (buf[0] == (12|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (_errno == 0) {

		    let bytes_read = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

		    console.log("<-- read: bytes_read="+bytes_read+" bytes");

		    let buf2;

		    if (read_ptr) { // Workaround because of wasi adapter ??? read_ptr is set by fd_read

			buf2 = read_ptr;
			read_ptr = 0;
		    }
		    else {

			buf2 = getI32(HEAPU8, retptr+4);

			console.log("buf2 from param ="+buf2);
			
			if (!buf2 || (buf2 > (HEAPU8.length-bytes_read))) { // Do not know how to implement it when buf2 is not valid

			    buf2 = (getFunc("cabi_realloc"))(0, 0, 4, bytes_read);
			}
		    }

		    HEAPU8.set(buf.subarray(20, 20+bytes_read), buf2);

		    setI32(HEAPU8, retptr+4, buf2);
		    setI32(HEAPU8, retptr+8, bytes_read);

		    return 0;
		}

		return _errno;
	    }

	    return -1;
	}

	const ret = handleReadResponse(this.sharedDataArray);

	if (retptr) {
	    HEAPU8[retptr] = ret;

	    return ret;
	}
	else {

	    return ret;
	}
    },

    fstat(fd, retptr) {

	let do_fstat = () => {
		
	    let buf_size = 1256;
	    
	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 29; // FSTAT
	    
	    let pid = this.pid;
	    
	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = this.fd_table[fd].remote_fd;
	    
	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    let msg = {
		
		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	if ( (fd in this.fd_table) && (this.fd_table[fd]) ) {

	    do_fstat();
	}
	else {

	    if (this.is_open(fd) >= 0) {

		do_fstat();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleFstatResponse(buf) {

	    if (buf[0] == (29|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (_errno == 0) {

		    let len = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

		    retptr.set(buf.subarray(20, 20+len));

		    return len;
		}

		return -_errno;
	    }

	    return -1;
	}

	return handleFstatResponse(this.sharedDataArray);
    },

    exit(status) {

	let buf_size = 20;
	    
	let buf2 = new Uint8Array(buf_size);

	buf2[0] = 38; // EXIT

	let pid = this.pid;

	// pid
	buf2[4] = pid & 0xff;
	buf2[5] = (pid >> 8) & 0xff;
	buf2[6] = (pid >> 16) & 0xff;
	buf2[7] = (pid >> 24) & 0xff;

	// status
	buf2[12] = status & 0xff;
	buf2[13] = (status >> 8) & 0xff;
	buf2[14] = (status >> 16) & 0xff;
	buf2[15] = (status >> 24) & 0xff;
	
	let msg = {
	    
	    from: this.rcv_bc_channel_name,
	    buf: buf2,
	    len: buf_size
	};

	let bc = this.resmgr_bc_channel;

	bc.postMessage(msg);

	Atomics.wait(this.sharedEventArray, 0, 0);
    },

    socket(domain, type, protocol) {

	console.log("socket: domain="+domain+", type="+type+", protocol="+protocol);
	
	let bc = this.resmgr_bc_channel;

	let buf = new Uint8Array(256);

	buf[0] = 9; // SOCKET
	
	/*//padding
	  buf[1] = 0;
	  buf[2] = 0;
	  buf[3] = 0;*/

	let pid = this.pid;

	// pid
	buf[4] = pid & 0xff;
	buf[5] = (pid >> 8) & 0xff;
	buf[6] = (pid >> 16) & 0xff;
	buf[7] = (pid >> 24) & 0xff;

	// errno
	buf[8] = 0x0;
	buf[9] = 0x0;
	buf[10] = 0x0;
	buf[11] = 0x0;

	// fd
	buf[12] = 0x0;
	buf[13] = 0x0;
	buf[14] = 0x0;
	buf[15] = 0x0;
	
	// domain
	buf[16] = domain & 0xff;
	buf[17] = (domain >> 8) & 0xff;
	buf[18] = (domain >> 16) & 0xff;
	buf[19] = (domain >> 24) & 0xff;

	// type
	buf[20] = type & 0xff;
	buf[21] = (type >> 8) & 0xff;
	buf[22] = (type >> 16) & 0xff;
	buf[23] = (type >> 24) & 0xff;

	// protocol
	buf[24] = protocol & 0xff;
	buf[25] = (protocol >> 8) & 0xff;
	buf[26] = (protocol >> 16) & 0xff;
	buf[27] = (protocol >> 24) & 0xff;

	let msg = {

	    from: this.rcv_bc_channel_name,
	    buf: buf,
	    len: 256
	};

	Atomics.store(this.sharedEventArray, 0, 0);

	bc.postMessage(msg);

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleSocketResponse(buf, fd_table) {

	    if (buf[0] == (9|0x80)) {

		let _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (_errno == 0) {

		    let fd = buf[12] | (buf[13] << 8) | (buf[14] << 16) |  (buf[15] << 24);

		    let ops = null;
		    let remote_fd  = buf[28] | (buf[29] << 8) | (buf[30] << 16) |  (buf[31] << 24);

		    if (domain == 1) { // AF_UNIX

			/*if (type == 1)       //SOCK_STREAM
			  ops = SOCKFS.stream_ops;
			  else if (type == 2)  // SOCK_DGRAM
			  ops = SOCKFS.unix_dgram_sock_ops;*/
		    }

		    // create our internal socket structure
		    let sock = {
			fd: fd,
			remote_fd: remote_fd,
			family: domain,
			type: type,
			protocol: protocol,
			server: null,
			error: null, // Used in getsockopt for SOL_SOCKET/SO_ERROR test
			peers: {},
			pending: [],
			recv_queue: [],
			name: null,
			bc: null,
			sock_ops: ops,
		    };

		    if (domain != 1) {
			
			sock.type = buf[32];
			sock.major = buf[34] | (buf[35] << 8);
			sock.minor = buf[36] | (buf[37] << 8);
			sock.peer = Utf8ArrayToStr(buf.subarray(38, 38+108));

			console.log("Socket: peer="+sock.peer);
		    }

		    fd_table[fd] = sock;

		    return fd;
		}
		else {

		    return -_errno;
		}
	    }

	    return -1;
	}
	
	return handleSocketResponse(this.sharedDataArray, this.fd_table); 
    },

    connect(fd, addr, addrlen) {

	console.log("connect: family="+this.fd_table[fd].family);
	console.log(addr);

	if ( (this.fd_table[fd].family == 2) || (this.fd_table[fd].family == 10) ) {

	    let buf_size = 20+40;

	    let buf2 = new Uint8Array(buf_size);

	    buf2[0] = 55; // CONNECT

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = this.fd_table[fd].remote_fd;

	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    if (addrlen > 40)
		addrlen = 40;
	    
	    // addrlen
	    buf2[16] = addrlen & 0xff;
	    buf2[17] = (addrlen >> 8) & 0xff;
	    buf2[18] = (addrlen >> 16) & 0xff;
	    buf2[19] = (addrlen >> 24) & 0xff;

	    // addr
	    buf2.set(addr, 20);

	    console.log(buf2);
	    
	    let msg = {
		
		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    console.log("Send connect msg to "+this.fd_table[fd].peer);

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    Atomics.store(this.sharedEventArray, 0, 0);

	    driver_bc.postMessage(msg);

	    Atomics.wait(this.sharedEventArray, 0, 0);

	    console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	    Atomics.store(this.sharedEventArray, 0, 0);

	    console.log(this.sharedDataArray);

	    function handleConnectResponse(buf) {

		if (buf[0] == (55|0x80)) {

		    const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		    console.log("Connect: _errno="+_errno);

		    return -_errno;
		}

		return -1;
	    }

	    return handleConnectResponse(this.sharedDataArray);
	}
	else {

	    return -1;
	}
    },
    bind(fd, addr, addrlen) {

	if ( (this.fd_table[fd].family == 2) || (this.fd_table[fd].family == 10) ) {

	    let buf_size = 20+40;

	    let buf2 = new Uint8Array(buf_size);

	    buf2[0] = 10; // BIND

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    let remote_fd = this.fd_table[fd].remote_fd;

	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;
	    
	    // addr
	    buf2.set(addr, 16);
	    
	    let msg = {
		
		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    console.log("Send bind msg to "+this.fd_table[fd].peer);

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    Atomics.store(this.sharedEventArray, 0, 0);

	    driver_bc.postMessage(msg);

	    Atomics.wait(this.sharedEventArray, 0, 0);

	    console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	    Atomics.store(this.sharedEventArray, 0, 0);

	    console.log(this.sharedDataArray);

	    function handleBindResponse(buf) {

		if (buf[0] == (10|0x80)) {

		    const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		    return -_errno;
		}

		return -1;
	    }

	    return handleBindResponse(this.sharedDataArray);
	}
	else {

	    return -1;
	}
    },
    getdents(fd, dirp, count) {

	let do_getdents = () => {

	    let buf_size = 256;
	    
	    let buf2 = new Uint8Array(buf_size);
	    
	    buf2[0] = 36; // GETDENTS

	    /*//padding
	      buf[1] = 0;
	      buf[2] = 0;
	      buf[3] = 0;*/

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    // errno
	    buf2[8] = 0x0;
	    buf2[9] = 0x0;
	    buf2[10] = 0x0;
	    buf2[11] = 0x0;

	    let remote_fd = this.fd_table[fd].remote_fd;
	       
	    // remote_fd
	    buf2[12] = remote_fd & 0xff;
	    buf2[13] = (remote_fd >> 8) & 0xff;
	    buf2[14] = (remote_fd >> 16) & 0xff;
	    buf2[15] = (remote_fd >> 24) & 0xff;

	    // count
	    buf2[16] = count & 0xff;
	    buf2[17] = (count >> 8) & 0xff;
	    buf2[18] = (count >> 16) & 0xff;
	    buf2[19] = (count >> 24) & 0xff;
	    
	    /*const hid = Module['rcv_bc_channel'].set_handler( (messageEvent) => {

		//console.log(messageEvent);

		let msg2 = messageEvent.data;

		if (msg2.buf[0] == (36|0x80)) {

		    let _errno = msg2.buf[8] | (msg2.buf[9] << 8) | (msg2.buf[10] << 16) |  (msg2.buf[11] << 24);

		    //console.log("__syscall_lstat64: _errno="+_errno);

		    if (_errno == 0) {

			let len = msg2.buf[16] | (msg2.buf[17] << 8) | (msg2.buf[18] << 16) |  (msg2.buf[19] << 24);

			//console.log("__syscall_lstat64: len="+len);

			Module.HEAPU8.set(msg2.buf.slice(20, 20+len), dirp);

			wakeUp(len);
		    }
		    else {

			wakeUp(-_errno);
		    }

		    return hid;
		}

		return -1;
		});*/

	    let msg = {
		
		from: this.rcv_bc_channel_name,
		buf: buf2,
		len: buf_size
	    };

	    let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
	    
	    driver_bc.postMessage(msg);
	};

	if ( (fd in this.fd_table) && (this.fd_table[fd]) ) {

	    do_getdents();
	}
	else {

	    if (this.is_open(fd) >= 0) {

		do_getdents();
	    }
	    else {

		return -1;
	    }
	}

	Atomics.wait(this.sharedEventArray, 0, 0);

	console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

	Atomics.store(this.sharedEventArray, 0, 0);

	console.log(this.sharedDataArray);

	function handleGetdentsResponse(buf) {

	    if (buf[0] == (36|0x80)) {

		const _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

		if (!_errno) {

		    let len = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

		    console.log("getdents: len="+len);

		    dirp.set(buf.subarray(20, 20+len));

		    return len;
		}

		return -_errno;
	    }

	    return -1;
	}

	const len = handleGetdentsResponse(this.sharedDataArray);

	return len;
    },

    poll(fd_array) {

	console.log("--> poll");
	
	let ms = -1;

	let readfds_array = [];
	let writefds_array = [];

	for (let _fd of fd_array) {

	    if ('fd' in _fd) {

		if (_fd.inout == 0) { // read

		    readfds_array.push(_fd.fd);

		}
		else { // write

		    writefds_array.push(_fd.fd);
		}
	    }
	    else if ('timeout' in _fd) {

		ms =_fd.timeout;
	    }
	}

	let do_select = (fd, rw, start) => {

	    console.log("do_select: fd="+fd+", rw="+rw+", start="+start);

	    if (fd >= 0x70000000) { // timer

		//TODO

		return ;
	    }

	    let buf_size = 256;
	    
	    let buf2 = new Uint8Array(buf_size);

	    buf2[0] = 31; // SELECT

	    let pid = this.pid;

	    // pid
	    buf2[4] = pid & 0xff;
	    buf2[5] = (pid >> 8) & 0xff;
	    buf2[6] = (pid >> 16) & 0xff;
	    buf2[7] = (pid >> 24) & 0xff;

	    // fd
	    buf2[12] = fd & 0xff;
	    buf2[13] = (fd >> 8) & 0xff;
	    buf2[14] = (fd >> 16) & 0xff;
	    buf2[15] = (fd >> 24) & 0xff;

	    // rw
	    buf2[16] = rw & 0xff;
	    buf2[17] = (rw >> 8) & 0xff;
	    buf2[18] = (rw >> 16) & 0xff;
	    buf2[19] = (rw >> 24) & 0xff;
	    
	    let start_stop = 1;
	    
	    // start_stop
	    buf2[20] = start & 0xff;
	    buf2[21] = (start >> 8) & 0xff;
	    buf2[22] = (start >> 16) & 0xff;
	    buf2[23] = (start >> 24) & 0xff;

	    // once
	    buf2[28] = (ms == 0);
	    buf2[29] = 0;
	    buf2[30] = 0;
	    buf2[31] = 0;

	    /*if (Module['fd_table'][fd].timerfd) { // timerfd

	      Module['fd_table'][fd].select(fd, rw, start, function(_fd, rw) {
	      //console.log("timerfd notif_select _fd="+_fd);
	      
	      notif_select(_fd, rw);
	      });
	      }
	      else if (Module['fd_table'][fd].sock_ops) { // socket

	      Module['fd_table'][fd].sock_ops.select(getSocketFromFD(fd), fd, rw, start, function(_fd, rw) {

	      //console.log("sock notif_select _fd="+_fd);

	      notif_select(_fd, rw);
	      });
	      }
	      else if (Module['fd_table'][fd].select) { // TODO: to be generalize 

		Module['fd_table'][fd].select(fd, rw, start, function(_fd, rw) {
		    //console.log("timerfd notif_select _fd="+_fd);
		    
		    notif_select(_fd, rw);
		});
	    }
	    else*/ { // any other type of fd (remote)

		let remote_fd = this.fd_table[fd].remote_fd;

		// remote fd
		buf2[24] = remote_fd & 0xff;
		buf2[25] = (remote_fd >> 8) & 0xff;
		buf2[26] = (remote_fd >> 16) & 0xff;
		buf2[27] = (remote_fd >> 24) & 0xff;

		let msg = {
		    
		    from: this.rcv_bc_channel_name,
		    buf: buf2,
		    len: buf_size
		};

		//console.log("__syscall_pselect6: peer="+Module['fd_table'][fd].peer);

		let driver_bc = new BroadcastChannel(this.fd_table[fd].peer);
		
		driver_bc.postMessage(msg);
	    }
	};

	let notif_select = (fd, rw) => {

	    //console.log("__syscall_pselect6: notify_select: fd="+fd+", nfds="+nfds);

	    /* Workaround before implement id in syscall */
	    if ( (fd != -1) && ((rw && !writefds_array.includes(fd)) || (!rw && !readfds_array.includes(fd)) ) )
		return;

	    // Stop select timer
	    
	    if (ms >= 0) {

		const msg = {

		    op: 'select_timer',
		    duration: -1, // -1 means stop timer
		};

		self.postMessage(msg);
	    }
	    
	    // Stop select for readfds if not once

	    if (ms != 0) {
		
		for (let readfd of readfds_array) {

		    if ( (readfd in this.fd_table) && (this.fd_table[readfd]) ) {

			do_select(readfd, 0, 0);
		    }
		}

		// Stop select for writefds

		for (let writefd of writefds_array) {

		    if ( (writefd in this.fd_table) && (this.fd_table[writefd]) ) {

			do_select(writefd, 1, 0);
		    }
		}
	    }
	};

	let selectfds_array = [].concat(readfds_array, writefds_array);

	let check_unknown_fds = (fds, callback) => {

	    if (fds.length == 0) {
		
		return callback();
	    }

	    let fd = fds.pop();

	    if ( !(fd in this.fd_table) || !this.fd_table[fd] ) {
		
		if (this.is_open(fd) < 0) {

		    return -1;
		}
	    }
	    
	    return check_unknown_fds(fds, callback);
	};

	return check_unknown_fds(selectfds_array, () => {

	    console.log("check_unknown_fds done");

	    /*const hid = Module['rcv_bc_channel'].set_handler( (messageEvent) => {

		    let msg2 = messageEvent.data;
		    
		    if (msg2.buf[0] == (31|0x80)) {

			let fd = msg2.buf[12] | (msg2.buf[13] << 8) | (msg2.buf[14] << 16) |  (msg2.buf[15] << 24);

			let rw = msg2.buf[16] | (msg2.buf[17] << 8) | (msg2.buf[18] << 16) |  (msg2.buf[19] << 24);

			//console.log("__syscall_pselect6: return of fd="+fd+", rw="+rw);
			
			notif_select(fd, rw);

			return hid;
		    }
		    else if (msg2.buf[0] == 62) { // END_OF_SIGNAL Signal received and handled

			//console.log("Signal has interrupted select syscall");
			
			//TODO: check flags
			
			wakeUp(-4); //EINTR

			return hid;
		    }
		    else {

			return -1;
		    }
		});*/

	    let i = 0;

	    // Start select for readfds
	    
	    for (let readfd of readfds_array) {

		if ( (readfd in this.fd_table) && (this.fd_table[readfd]) ) {

		    i++;
		    do_select(readfd, 0, 1);
		}
	    }
		
	    // Start select for writefds

	    for (let writefd of writefds_array) {

		if ( (writefd in this.fd_table) && (this.fd_table[writefd]) ) {

		    i++;
		    do_select(writefd, 1, 1);
		}
	    }

	    if ( (i == 0) && (ms < 0)) { // no fd for select

		return -1;
	    }
	    else if (ms >= 0) {

		/*Module['select_timer'] = setTimeout(() => {

		    Module['rcv_bc_channel'].unset_handler(hid);
		    
		    notif_select(-1, -1);
		    
		    }, Math.floor(((s == 0) && (ns == 0))?5:s*1000+ns/1000000));*/

		const msg = {

		    op: 'select_timer',
		    duration: (ms == 0)?5:ms, // duration in msec
		};

		self.postMessage(msg);
	    }

	    while (1) {

		Atomics.wait(this.sharedEventArray, 0, 0);

		console.log("Worker: rcv_bc msg: "+this.sharedEventArray[0]);

		Atomics.store(this.sharedEventArray, 0, 0);

		console.log(this.sharedDataArray);

		function handleSelectResponse(buf) {

		    if (buf[0] == (31|0x80)) {

			let fd = buf[12] | (buf[13] << 8) | (buf[14] << 16) |  (buf[15] << 24);

			let rw = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

			console.log("return of select for fd="+fd+", rw="+rw);
			
			notif_select(fd, rw); 

			return fd;
		    }

		    return -2;
		}

		let fd = handleSelectResponse(this.sharedDataArray);

		if (fd >= -1) {

		    return fd;
		}
	    }
	    
	});
    }
}

function Utf8ArrayToStr(array) {
    var out, i, len, c;
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while(i < len) {
	c = array[i++];

	if (c == 0)
	    break;
	
    switch(c >> 4)
    { 
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
        // 0xxxxxxx
        out += String.fromCharCode(c);
        break;
      case 12: case 13:
        // 110x xxxx   10xx xxxx
        char2 = array[i++];
        out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
        break;
      case 14:
        // 1110 xxxx  10xx xxxx  10xx xxxx
        char2 = array[i++];
        char3 = array[i++];
        out += String.fromCharCode(((c & 0x0F) << 12) |
                       ((char2 & 0x3F) << 6) |
                       ((char3 & 0x3F) << 0));
        break;
    }
    }

    return out;
}
