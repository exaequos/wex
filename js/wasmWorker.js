importScripts("./wasi_syscalls.js");

var memory;
var old_buffer;
var HEAPU8;

var args, env_count, env_size, env;

var read_ptr = 0; // for Fixing blocking read ptr (wasi 0.2) : it is set by fd_read (wasi 0.1)

let instances = new Array();

var preOpens = {};

var directoryStreams = {};

var p1_fd_readdir_entries = {};

var timer_fd = 0x70000000;

var poll_id = 0;

var pollables = {};

var trace = false;
var info = false;

var directories = "";

function update_heap() {

    if (old_buffer !== memory.buffer) {
	console.log("Memory was reallocated");

	old_buffer = memory.buffer;

	HEAPU8 = new Uint8Array(memory.buffer);
    }
}

function print_trace(str, newline = true) {

    const buf = new TextEncoder().encode((newline?"\n":"")+"[TRACE] " + str+"\n");

    ((Syscalls.blocking_write_and_flush).bind(Syscalls))(2, buf, buf.length, 0);
}

function getI32(arr, off) {

    return arr[off] | (arr[off+1] << 8) | (arr[off+2] << 16) | (arr[off+3] << 24);
}

function getI64(arr, off) {

    return BigInt(arr[off]) | (BigInt(arr[off+1]) << 8n) | (BigInt(arr[off+2]) << 16n) | (BigInt(arr[off+3]) << 24n) | (BigInt(arr[off+4]) << 32n) | (BigInt(arr[off+5]) << 40n) | (BigInt(arr[off+6]) << 48n) | (BigInt(arr[off+7]) << 56n);
}

function getI16(arr, off) {

    return arr[off] | (arr[off+1] << 8);
}

function setI32(arr, off, val) {

    arr[off] = val & 0xff;
    arr[off+1] = (val >> 8) & 0xff;
    arr[off+2] = (val >> 16) & 0xff;
    arr[off+3] = (val >> 24) & 0xff;
}

function setI64(arr, off, val) { // val is BigInt

    arr[off] = Number(val) & 0xff;
    arr[off+1] = Number(val >> BigInt(8)) & 0xff;
    arr[off+2] = Number(val >> BigInt(16)) & 0xff;
    arr[off+3] = Number(val >> BigInt(24)) & 0xff;
    arr[off+4] = Number(val >> BigInt(32)) & 0xff;
    arr[off+5] = Number(val >> BigInt(40)) & 0xff;
    arr[off+6] = Number(val >> BigInt(48)) & 0xff;
    arr[off+7] = Number(val >> BigInt(56)) & 0xff;
}

function setI16(arr, off, val) {

    arr[off] = val & 0xff;
    arr[off+1] = (val >> 8) & 0xff;
}

function do_preopens() {

    console.log("--> do_preopens: "+directories);

    const dirs = directories.split("|");

    console.log(dirs);

    for (let dir of dirs) {

	const paths = dir.split("::");

	const host_dir = paths[0];

	const guest_dir = (paths.length > 1)?paths[1]:paths[0];
	
	let posix_flags = 0;
	    
	posix_flags |= 00200000;  // O_DIRECTORY
	posix_flags |= 00000002; // O_RDWR
	    
	let fd = (Syscalls.openat).bind(Syscalls)(-100, host_dir, host_dir.length, posix_flags, 0);
	    
	console.log("do_preopens: openat "+host_dir+" --> fd="+fd+" guest="+guest_dir);
	
	if (fd >= 0) {
	    
	    preOpens[fd] = { path: guest_dir, type: 0 };
	}
    }
}

function create_pollable(fd, inout) {

    poll_id++;

    pollables[poll_id] = {fd: fd, inout: inout, ready: false};

    console.log("create_pollable: fd="+fd+" -> "+poll_id);

    return poll_id;
}

function get_arguments(ptr) {

    update_heap();
    
    console.log("--> get-arguments: "+ptr);

    console.log("--> get-arguments: "+getI32(HEAPU8, ptr)+", "+getI32(HEAPU8, ptr+4));
    
    let nb_args = 0;

    for (let i=0; i < args.length; ++i) {

	if (args.charCodeAt(i) == 32) {

	    nb_args++;
	}
    }

    console.log("--> nb_args: "+nb_args);

    const buf = (getFunc("cabi_realloc"))(0, 0, 4, args.length);
    const list = (getFunc("cabi_realloc"))(0, 0, 4, 8*nb_args);

    console.log("--> buf: "+buf);
    console.log("--> list: "+list);

    let index = 0;
    let offset = 0;

    for (let i=0; i < args.length; i++) {

	if (offset >= 0) {
	    console.log(index+": offset="+offset);
	    setI32(HEAPU8, list+index*8, buf+offset);
	    offset = -offset-1;
	}

	if (args.charCodeAt(i) != 32) {
	    HEAPU8[buf+i] = args.charCodeAt(i);
	}
	else {
	    HEAPU8[buf+i] = 0;
	    setI32(HEAPU8, list+index*8+4, i+offset+1);
	    console.log(index+": length="+(i+offset+1));
	    offset = i+1;
	    index++;
	}
    }

    setI32(HEAPU8, ptr, list);
    setI32(HEAPU8, ptr+4, nb_args);

    return 0;
}

function get_stdin() {

    return 0;
}

function get_stdout() {

    return 1;
}

function get_stderr() {

    return 2;
}

function get_directories(ptr) {

    update_heap();

    console.log("--> get_directories: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    const buf = (getFunc("cabi_realloc"))(0, 0, 0, 4);
    const list = (getFunc("cabi_realloc"))(0, 0, 0, 8*1);

    HEAPU8[buf] = 46; // '.'
    HEAPU8[buf+1] = 0; // '.'

    /*HEAPU8[buf+2] = 47; // '/'
    HEAPU8[buf+3] = 0; // '.'*/
    
    setI32(HEAPU8, list, -100);
    setI32(HEAPU8, list+4, buf);
    setI32(HEAPU8, list+8, 1);

    setI32(HEAPU8, ptr, list);
    setI32(HEAPU8, ptr+4, 1);

    return 0;
}

function read_directory(fd, retptr) {

    console.log("--> read_directory: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    const count = 8192;

    let arr = new Uint8Array(count);
    
    const len = (Syscalls.getdents).bind(Syscalls)(fd, arr, count);

    console.log("<-- read_directory: len="+len);

    // TODO: handle case when need to read more

    // TODO: handle multiple streams

    if (len >= 0) {

	console.log(arr);

	directoryStreams[fd] = {

	    dirp: arr,
	    len: len,
	    index: 0
	};
    
	HEAPU8[retptr] = 0; // 0 = OK
	setI32(HEAPU8, retptr+4, fd);
    }
    else {

	HEAPU8[retptr] = 1; // 1 = NOK
	HEAPU8[retptr+4] = -len;
    }
}

function read_directory_entry(fd, retptr) {
    
    console.log("--> read_directory_entry: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (fd in directoryStreams) {
	
	HEAPU8[retptr] = 0; // 0 = OK

	if /*(directoryStreams[fd].index < directoryStreams[fd].len)*/(0) {

	    console.log("read_directory_entry: entry found");
    
	    HEAPU8[retptr+4] = 1; // option = 1

	    const reclen = getI16(directoryStreams[fd].dirp, directoryStreams[fd].index+8);

	    console.log("read_directory_entry: reclen="+reclen);

	    let s = "";

	    for (let i = 0; i < reclen-16; i++) {

		s += String.fromCharCode(directoryStreams[fd].dirp[directoryStreams[fd].index+15+i]);
	    }

	    console.log("read_directory_entry: "+s);

	    console.log("read_directory_entry: read_ptr="+read_ptr);

	    let buf = read_ptr || (getFunc("cabi_realloc"))(0, 0, 4, reclen-15); // add 1 for trailing zero

	    console.log("read_directory_entry: buf="+buf);

	    HEAPU8.set(directoryStreams[fd].dirp.subarray(directoryStreams[fd].index+15, directoryStreams[fd].index+15+reclen-16), buf);
	    HEAPU8[buf+reclen-16] = 0;

	    console.log(HEAPU8.subarray(buf, buf+reclen-15));

	    setI32(HEAPU8, retptr+12, buf);
	    setI32(HEAPU8, retptr+16, reclen-16);

	    directoryStreams[fd].index += reclen;
	}
	else {

	    console.log("read_directory_entry: not more entry");

	    HEAPU8[retptr+4] = 0; // option = 0
	}
    }
    else {

	console.log("read_directory_entry: stream not found");

	HEAPU8[retptr] = 1; // 1= NOK
    }
}

function descriptor_get_flags() {

    console.log("--> descriptor_get_flags: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function desc_type(mode) {

    /*
	// The type of the descriptor or file is unknown or is different from
// any of the other types specified.
#define FILESYSTEM_DESCRIPTOR_TYPE_UNKNOWN 0
// The descriptor refers to a block device inode.
#define FILESYSTEM_DESCRIPTOR_TYPE_BLOCK_DEVICE 1
// The descriptor refers to a character device inode.
#define FILESYSTEM_DESCRIPTOR_TYPE_CHARACTER_DEVICE 2
// The descriptor refers to a directory inode.
#define FILESYSTEM_DESCRIPTOR_TYPE_DIRECTORY 3
// The descriptor refers to a named pipe.
#define FILESYSTEM_DESCRIPTOR_TYPE_FIFO 4
// The file refers to a symbolic link inode.
#define FILESYSTEM_DESCRIPTOR_TYPE_SYMBOLIC_LINK 5
// The descriptor refers to a regular file inode.
#define FILESYSTEM_DESCRIPTOR_TYPE_REGULAR_FILE 6
// The descriptor refers to a socket.
#define FILESYSTEM_DESCRIPTOR_TYPE_SOCKET 7
*/

    if ((mode & 0170000) == 0100000) {
	return 6; // type = regular file
    }
    else if ((mode & 0170000) == 0040000) {
	return 3; // type = directory
    }
    else if ((mode & 0170000) == 0020000) {
	return 2; // type = character device
    }
    else if ((mode & 0170000) == 0060000) {
	return 1; // type = block device
    }
    
    return 0; // unknwown
}

function file_type(mode) {

    /*
#define __WASI_FILETYPE_UNKNOWN (UINT8_C(0))
#define __WASI_FILETYPE_BLOCK_DEVICE (UINT8_C(1))
#define __WASI_FILETYPE_CHARACTER_DEVICE (UINT8_C(2))
#define __WASI_FILETYPE_DIRECTORY (UINT8_C(3))
#define __WASI_FILETYPE_REGULAR_FILE (UINT8_C(4))
#define __WASI_FILETYPE_SOCKET_DGRAM (UINT8_C(5))
#define __WASI_FILETYPE_SOCKET_STREAM (UINT8_C(6))
#define __WASI_FILETYPE_SYMBOLIC_LINK (UINT8_C(7))
*/

    if ((mode & 0170000) == 0100000) {
	return 4; // type = regular file
    }
    else if ((mode & 0170000) == 0040000) {
	return 3; // type = directory
    }
    else if ((mode & 0170000) == 0020000) {
	return 2; // type = character device
    }
    else if ((mode & 0170000) == 0060000) {
	return 1; // type = block device
    }
    
    return 0; // unknwown
}

function file_type_from_dt(d_type) {

    /*
      #define DT_UNKNOWN  0   Unknown type 
#define DT_FIFO     1   Named pipe (FIFO) 
#define DT_CHR      2   Character device 
#define DT_DIR      4   Directory 
#define DT_BLK      6   Block device 
#define DT_REG      8   Regular file 
#define DT_LNK     10   Symbolic link 
#define DT_SOCK    12   Socket 
#define DT_WHT     14   (whiteout, BSD) 
    */

    if (d_type == 8) {
	return 4; // type = regular file
    }
    else if (d_type == 4) {
	return 3; // type = directory
    }
    else if (d_type == 2) {
	return 2; // type = character device
    }
    else if (d_type == 6) {
	return 1; // type = block device
    }
    
    return 0; // unknwown
}

function get_type(fd, retptr) {

    console.log("--> get_type: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (fd == -100) {

	HEAPU8[retptr] = 0; // 0 = OK
	HEAPU8[retptr+1] = 3; // type = directory since it is '.'
    }
    else {

	let arr = new Uint8Array(128);

	const len = (Syscalls.fstat).bind(Syscalls)(fd, arr);
	
	console.log("<-- fstat: len="+len);

	if (len >= 0) {

	    const mode = getI32(arr, 12);

	    console.log("mode="+mode+", desc_type="+desc_type(mode));

	    HEAPU8[retptr] = 0; // 0 = OK
	    HEAPU8[retptr+1] = desc_type(mode);
	}
	else {

	    HEAPU8[retptr] = 1; // 1 = NOK
	    HEAPU8[retptr+1] = -len; // errror code
	}
    }

    return 0;
}

function stat(fd, retptr) {

    console.log("--> stat: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let arr = new Uint8Array(128);

    const len = (Syscalls.fstat).bind(Syscalls)(fd, arr);
    
    console.log("<-- fstat: len="+len);

    if (len >= 0) {

	HEAPU8[retptr] = 0; // 0 = OK

	const mode = getI32(arr, 12);

	HEAPU8[retptr+8] = desc_type(mode);

	setI64(HEAPU8, retptr+16, BigInt(1));

	const size = getI32(arr, 36);

	console.log("<-- fstat: size="+size);
	
	setI64(HEAPU8, retptr+24, BigInt(size));

	// No date/time
	
	HEAPU8[retptr+32] = 0; // option = 0
	HEAPU8[retptr+56] = 0;
	HEAPU8[retptr+80] = 0;
    }
    else {

	HEAPU8[retptr] = 1; // 1 = NOK
	HEAPU8[retptr+8] = -len;
    }
}

function drop_descriptor(fd) {

    console.log("--> drop_descriptor: fd="+fd);

    return 0;
}

function open_at(dirfd, path_flags, path, len, open_flags, flags, ptr) {

    console.log("--> open_at: dirfd="+dirfd+", path_flags="+path_flags+", open_flags="+open_flags+", flags="+flags);
    
    let s = "";

    for (let i = 0; i < len; i++) {

	s += String.fromCharCode(HEAPU8[path+i]);
    }

    console.log("--> open_at: path="+s);

    let posix_flags = 0;

    if (path_flags & 0x01) { // FILESYSTEM_PATH_FLAGS_SYMLINK_FOLLOW

	//TODO
    }

    /*
// Create file if it does not exist, similar to `O_CREAT` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_CREATE (1 << 0)
// Fail if not a directory, similar to `O_DIRECTORY` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_DIRECTORY (1 << 1)
// Fail if file already exists, similar to `O_EXCL` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_EXCLUSIVE (1 << 2)
// Truncate file to size 0, similar to `O_TRUNC` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_TRUNCATE (1 << 3)
    */

    if (open_flags & 1)
	posix_flags |= 00000100;  // O_CREAT
    if (open_flags & 2)
	posix_flags |= 00200000;  // O_DIRECTORY
    if (open_flags & 4)
	posix_flags |= 00000200;  // O_EXCL
    if (open_flags & 8)
	posix_flags |= 00001000;  // O_TRUNC
/*
// Read mode: Data can be read.
#define FILESYSTEM_DESCRIPTOR_FLAGS_READ (1 << 0)
// Write mode: Data can be written to.
#define FILESYSTEM_DESCRIPTOR_FLAGS_WRITE (1 << 1)
*/

    if ((flags & 3) == 1)
	posix_flags |= 00000000;  // O_RDONLY
    else if ((flags & 3) == 2)
	posix_flags |= 00000001;  // O_WRONLY
    else if ((flags & 3) == 3)
	posix_flags |= 00000002;  // O_RDWR

    const mode = 0;

    let fd = (Syscalls.openat).bind(Syscalls)(dirfd, path, len, posix_flags, mode);

    console.log("<-- openat: fd="+fd);

    if (fd >= 0) {
	
	HEAPU8[ptr] = 0;
	setI32(HEAPU8, ptr+4, fd);
    }
    else {
	
	HEAPU8[ptr] = 1;
	setI32(HEAPU8, ptr+4, -fd);
    }

    return 0;
}

function read_via_stream(fd, offset, ptr) {

    console.log("--> read_via_stream: fd="+fd+", offset="+offset);

    let off = (Syscalls.lseek).bind(Syscalls)(fd, Number(offset), 0);

    console.log("<-- lseek: offset="+off);

    HEAPU8[ptr] = 0;
    
    setI32(HEAPU8, ptr+4, fd);

    return 0;
}

function write_via_stream(fd, offset, ptr) {

    console.log("--> write_via_stream: fd="+fd+", offset="+offset);

    let off = (Syscalls.lseek).bind(Syscalls)(fd, Number(offset), 0);

    console.log("<-- lseek: offset="+off);
    
    HEAPU8[ptr] = 0;
    
    setI32(HEAPU8, ptr+4, fd);
    
    return 0;
}

function drop_output_stream() {

    console.log("--> drop_output_stream: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    
    
    return 0;
}

function get_environment() {

    console.log("--> get_environment: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    setI32(HEAPU8, arguments[0], 0);

    return 0;
}

function filesystem_error_code() {

    console.log("--> filesystem_error_code: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
    
    setI32(HEAPU8, arguments[1], 0);

    return 0;
}

function error() {

    console.log("--> error: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
    
    return 0;
}

function error_to_debug_string() {

    console.log("--> error_to_debug_string: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
    
    return 0;
}

function wallclock_now(ptr) {

    console.log("--> now: "+ptr);
    
    //for (let i = 0; i < arguments.length; ++i)
//	console.log(arguments[i]);

    const t = Date.now();

    const t_sec = BigInt(Math.floor(t/1000));
    const t_nsec = (BigInt(t)-t_sec*1000n)*1000n;

    console.log(t_sec+", "+t_nsec);

    setI64(HEAPU8, ptr, t_sec);
    setI64(HEAPU8, ptr+8, t_nsec);

    return 0;
}

function mono_now() {

    const t = Date.now();

    console.log("--> mono_now: "+t);

    return BigInt(t)*1000000n;
}

function subscribe_duration(dur) {

    console.log("--> subscribe_duration: dur="+dur);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    timer_fd++;
    
    const msg = {

	op: 'subscribe_duration',
	duration: Number(dur / 1000000n), // duration in msec
	fd: timer_fd,
    };

    const poll_id = create_pollable(timer_fd, 0);
    
    self.postMessage(msg);

    return poll_id;
}

function subscribe_instant() {

    console.log("--> subscribe_instant: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function poll(polls, len, ptr) {

    update_heap();

    console.log("--> poll: len="+len);

    let fd_array = new Array();
    
    for (let i = 0; i < len; ++i) {

	const pollable = getI32(HEAPU8, polls+4*i);
	
	console.log("pollable="+pollable);
	
	fd_array.push({fd: pollables[pollable].fd, inout: pollables[pollable].inout});
    }

    const fd = (Syscalls.poll).bind(Syscalls)(fd_array);

    console.log("<-- poll : fd="+fd);

    // ???

    let buf = (getFunc("cabi_realloc"))(0, 0, 4, 4); // list contains only one index

    HEAPU8 = new Uint8Array(memory.buffer);

    //let buf = fds+32-4; // buf is put at the end of fds but where exactly ???

    for (let i = 0; i < len; ++i) {

	const pollable = getI32(HEAPU8, polls+4*i);
	
	if (pollables[pollable].fd == fd) {

	    setI32(HEAPU8, buf, i);
	}
    }

    setI32(HEAPU8, ptr, buf);
    setI32(HEAPU8, ptr+4, 1); // list contains only one index
}

function pollable_block(pollable) {

    console.log("--> pollable_block: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    const fd = (Syscalls.poll).bind(Syscalls)([{fd: pollables[pollable].fd, inout: pollables[pollable].inout}]);

    console.log("<-- pollable_block: fd="+fd);
}

function pollable_ready(pollable) {

    console.log("--> pollable_ready: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let ready = 0;

    const fd = (Syscalls.poll).bind(Syscalls)([{fd: pollables[pollable].fd, inout: pollables[pollable].inout}, {timeout: 0}]); // timeout = 0 means "once" poll

    if (fd == pollables[pollable].fd) {

	ready = 1;
    }

    console.log("<-- pollable_ready: "+arguments.length);

    return ready;
}

function metadata_hash(fd, retptr) {

    console.log("--> metadata_hash: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let arr = new Uint8Array(128);

    const len = (Syscalls.fstat).bind(Syscalls)(fd, arr);

    if (len >= 0) {

	HEAPU8[retptr] = 0; // 0 = OK
	setI64(HEAPU8, retptr+8, BigInt(fd));
	setI64(HEAPU8, retptr+16, BigInt(0));
    }
    else {

	HEAPU8[retptr] = 1; // 1 = NOK
	HEAPU8[retptr+8] = -len;
    }
}

function metadata_hash_at(fd, path_flags, ptr, len, retptr) {

    console.log("--> metadata_hash_at: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    HEAPU8[retptr] = 0; // 0 = OK
    
    setI64(HEAPU8, retptr+8, BigInt(fd));
    setI64(HEAPU8, retptr+16, BigInt(0));
}

function create_tcp_socket(address_family, retptr) {

    console.log("--> create_tcp_socket: familiy="+address_family);
    
    const fd = (Syscalls.socket).bind(Syscalls)((address_family == 0)?2:10, 1 /*SOCK_STREAM */, (address_family == 0)?2:10);

    console.log("<-- socket: fd="+fd);

    if (fd >= 0) {

	setI32(HEAPU8, retptr, 0);
	setI32(HEAPU8, retptr+4, fd);
    }
    else {

	setI32(HEAPU8, retptr, fd);
    }
}

function create_udp_socket(address_family, retptr) {

    console.log("--> create_udp_socket: familiy="+address_family);

    const fd = (Syscalls.socket).bind(Syscalls)((address_family == 0)?2:10, 2 /*SOCK_DGRAM*/, (address_family == 0)?2:10);

    console.log("<-- socket: fd="+fd);

    if (fd >= 0) {

	setI32(HEAPU8, retptr, 0);
	setI32(HEAPU8, retptr+4, fd);
    }
    else {

	setI32(HEAPU8, retptr, fd);
    }
}

function tcp_socket_subscribe() {

    console.log("--> tcp_socket_subscribe: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function udp_socket_subscribe() {

    console.log("--> udp_socket_subscribe: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function instance_network() {

    console.log("--> instance_network: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function start_connect(fd, network, variant, variant1, variant2, variant3, variant4, variant5, variant6, variant7, variant8, variant9, variant10, variant11, retptr) {

    console.log("--> start_connect: fd="+fd+", network="+network+", variant="+variant+", retptr="+retptr);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let addr;

    if (variant == 0) {

	addr = new Uint8Array(8);

	const family = 2;

	addr[0] = family & 0xff;
	addr[1] = (family >> 8) & 0xff;

	// Port and adress are sent MSB

	const port = variant1;

	addr[2] = (port >> 8) & 0xff;
	addr[3] = port & 0xff;

	addr[4] = variant2;
	addr[5] = variant3;
	addr[6] = variant4;
	addr[7] = variant5;
    }
    else {

	//TODO
    }

    const err = (Syscalls.connect).bind(Syscalls)(fd, addr, addr.length);
    
    HEAPU8[retptr] = err;
}

function finish_connect(fd, retptr) {

    console.log("--> finish_connect: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    HEAPU8[retptr] = 0;
    setI32(HEAPU8, retptr+4, fd);
    setI32(HEAPU8, retptr+8, fd);
}

function start_bind(fd, network, variant, variant1, variant2, variant3, variant4, variant5, variant6, variant7, variant8, variant9, variant10, variant11, retptr) {

    console.log("--> start_bind: fd="+fd+", network="+network+", variant="+variant+", retptr="+retptr);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let addr;

    if (variant == 0) {

	addr = new Uint8Array(8);

	const family = 2;

	addr[0] = family & 0xff;
	addr[1] = (family >> 8) & 0xff;

	// Port and adress are sent MSB

	const port = variant1;

	addr[2] = (port >> 8) & 0xff;
	addr[3] = port & 0xff;

	addr[4] = variant2;
	addr[5] = variant3;
	addr[6] = variant4;
	addr[7] = variant5;
    }
    else {

	//TODO
    }

    const err = (Syscalls.bind).bind(Syscalls)(fd, addr, addr.length);

    console.log("<-- start_bind: err="+err);

    if (!err) {
	HEAPU8[retptr] = 0;
	HEAPU8[retptr+1] = 0;
    }
    else {

	HEAPU8[retptr] = 1;
	HEAPU8[retptr+1] = err;
    }
}

function finish_bind(fd, retptr) {

    console.log("--> finish_bind: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    HEAPU8[retptr] = 0;
    HEAPU8[retptr+1] = 0;
}

function input_stream_subscribe(fd) {

    console.log("--> input_stream_subscribe: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    return create_pollable(fd, 0);
}

function input_stream_read() {

    console.log("--> input_stream_read: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function output_stream_subscribe(fd) {

    console.log("--> output_stream_subscribe: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    return create_pollable(fd, 1);
}

function check_write(fd, retptr) {

    console.log("--> check_write: fd="+fd);
    
    /*for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);*/
    
    HEAPU8[retptr] = 0;
    setI64(HEAPU8, retptr+8, BigInt(128*1024));
}

function output_stream_blocking_splice(fd_out, fd_in, length, retptr) {

    console.log("--> output_stream_blocking_splice: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    const buf = (Syscalls.blocking_read).bind(Syscalls)(fd_in, Number(length), 0);

    let _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

    if (_errno == 0) {

	let bytes_read = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

	if (bytes_read > 0) {

	    _errno = (Syscalls.blocking_write_and_flush).bind(Syscalls)(fd_out, buf.subarray(20, 20+bytes_read), bytes_read, 0);

	    if (err) {

		HEAPU8[retptr] = 1;

		setI32(HEAPU8, retptr+8, 0); // variant
		setI32(HEAPU8, retptr+12, _errno);
	    }
	    else {

		HEAPU8[retptr] = 0;
	    }
	}
    }
    else {

	HEAPU8[retptr] = 1;

	setI32(HEAPU8, retptr+8, 0); // variant
	setI32(HEAPU8, retptr+12, _errno);
    }
}

function create_directory_at() {

    console.log("--> create_directory_at: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function remove_directory_at() {

    console.log("--> remove_directory_at: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function unlink_file_at() {

    console.log("--> unlink_file_at: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function drop_tcp_socket() {

    console.log("--> drop_tcp_socket: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function udp_socket_stream(fd, option, option14, option15, option16, option17, option18, option19, option20, option21, option22, option23, option24, option25, retptr) {

    console.log("--> udp_socket_stream: fd="+fd);
    
    //for (let i = 0; i < arguments.length; ++i)
    //console.log(arguments[i]);

    let err = 0;

    if (option) {

	let addr;

	if (option14 == 0) {

	    addr = new Uint8Array(8);

	    const family = 2;

	    addr[0] = family & 0xff;
	    addr[1] = (family >> 8) & 0xff;

	    // Port and adress are sent MSB

	    const port = option15;

	    addr[2] = (port >> 8) & 0xff;
	    addr[3] = port & 0xff;

	    addr[4] = option16;
	    addr[5] = option17;
	    addr[6] = option17;
	    addr[7] = option18;
	}
	else {

	    //TODO
	}

	err = (Syscalls.connect).bind(Syscalls)(fd, addr, addr.length);
    }

    HEAPU8[retptr] = err;

    if (!err) {

	setI32(HEAPU8, retptr+4, fd);
	setI32(HEAPU8, retptr+8, fd);
    }
    else {

	setI32(HEAPU8, retptr+4, err);
    }
}

function get_random_bytes(len, retptr) {

    /*console.log("--> get_random_bytes: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);*/

    //console.log("buf="+getI32(HEAPU8, retptr)+", "+getI32(HEAPU8, retptr+4));

    const size = Number(len);

    //console.log("size="+size);

    const buf = getI32(HEAPU8, retptr) || (getFunc("cabi_realloc"))(0, 0, 4, size);
    
    for (let i=0; i < size; i++) {

	buf[i] = Math.floor(Math.random() * 256);
    }

    setI32(HEAPU8, retptr, buf);
    setI32(HEAPU8, retptr+4, size); // size is an int32 but len is int64 ????
}

function config_get(str, len, retptr) {

    console.log("--> config_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let key = "";

    for (let i = 0; i < len; i++) {

	key += String.fromCharCode(HEAPU8[str+i]);
    }

    console.log("key="+key);

    HEAPU8[retptr] = 0; // OK
    HEAPU8[retptr+1] = 0; // None
}

function config_get_all() {

    console.log("--> config_get_all: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    //TODO

}

function atomics_increment() {

    //TODO

}

function batch_get_many() {

    //TODO

}

function batch_set_many() {

    //TODO

}

function batch_delete_many() {

    //TODO

}

function store_drop_bucket() {

    //TODO

}

function store_open() {

    //TODO

}

function store_bucket_get() {

    //TODO

}

function store_bucket_set() {

    //TODO

}

function store_bucket_delete() {

    //TODO

}

function store_bucket_exists() {

    //TODO

}

function store_bucket_list_keys() {

    //TODO

}

function get_terminal_stdin() {

    console.log("--> get_terminal_stdin: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function get_terminal_stdout() {

    console.log("--> get_terminal_stdout: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function get_terminal_stderr() {

    console.log("--> get_terminal_stderr: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function resource_drop_terminal_input() {

    console.log("--> resource_drop_terminal_input: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}

function resource_drop_terminal_output() {

    console.log("--> resource_drop_terminal_output: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);
}


// WASI preview 1

function p1_proc_exit(status) {

    console.log("--> p1_proc_exit: "+arguments.length);

    
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::proc_exit status="+status);
    }

    ((Syscalls.exit).bind(Syscalls))(status);
}

function p1_proc_raise() {

    console.log("--> p1_proc_raise: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::proc_raise");
    }

    //TODO
}

function p1_sched_yield() {

    console.log("--> p1_sched_yield: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::sched_yield");
    }

    //TODO
}

function p1_sock_accept() {

    console.log("--> p1_sock_accept: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::sock_accept");
    }

    //TODO
}

function p1_sock_recv() {

    console.log("--> p1_sock_recv: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::sock_recv");
    }

    //TODO
}

function p1_sock_send() {

    console.log("--> p1_sock_send: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::sock_send");
    }

    //TODO
}

function p1_sock_shutdown() {

    console.log("--> p1_sock_shutdown: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::sock_shutdown");
    }

    //TODO
}

function p1_random_get(buf, size) {

    update_heap();

    console.log("--> p1_random_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::random_get buf="+buf+" size="+size);
    }

    for (let i=0; i < size; i++) {

	HEAPU8[buf+i] = Math.floor(Math.random() * 256);
    }
    
    return 0;
}

function p1_fd_prestat_get(fd, retptr) {

    update_heap();

    console.log("--> p1_fd_prestat_get: fd="+fd+", retptr="+retptr);

    if (trace) {
	print_trace("p1::fd_prestat_get fd="+fd+" retptr="+retptr);
    }

    if (!(fd in preOpens)) {

	if (trace) {
	    print_trace("<- ret=ERRNO_BADF", false);
	}
	
	return 8; // __WASI_ERRNO_BADF
    }

    HEAPU8[retptr] = preOpens[fd].type;
    
    setI32(HEAPU8, retptr+4, preOpens[fd].path.length);

    if (trace) {
	print_trace("<- ret=ERRNO_SUCCESS type="+preOpens[fd].type+" len="+preOpens[fd].path.length, false);
    }
    
    return 0; // __WASI_ERRNO_SUCCESS
}

function p1_fd_prestat_dir_name(fd, path, path_len) {

    update_heap();

    console.log("--> p1_fd_prestat_dir_name: fd="+fd+", path="+path+", path_len="+path_len);

    if (trace) {
	print_trace("p1::fd_prestat_dir_name fd="+fd+" path="+path+" path_len="+path_len);
    }

    if (!(fd in preOpens)) {

	if (trace) {
	    print_trace("<- ret=ERRNO_BADF", false);
	}
	
	return 8; // __WASI_ERRNO_BADF
    }

    const uint8array = new TextEncoder("utf-8").encode(preOpens[fd].path);

    HEAPU8.set(uint8array.subarray(0, path_len), path);

    if (trace) {
	print_trace("<- ret=ERRNO_SUCCESS path="+preOpens[fd].path, false);
    }

    return 0; // __WASI_ERRNO_SUCCESS
}

function p1_path_open(dirfd, path_flags, path, path_len, open_flags, fs_rights_base, fs_rights_inheriting, fdflags, retptr) {

    update_heap();

    console.log("--> p1_path_open: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_open dirfd="+dirfd+" path_flags="+path_flags+" path="+path+" path_len="+path_len+" open_flags="+open_flags+" fs_rights_base="+fs_rights_base+" fs_rights_inheriting="+fs_rights_inheriting+" fdflags="+fdflags+" retptr="+retptr);

	let td = new TextDecoder("utf-8");
	
	print_trace("path="+td.decode(HEAPU8.subarray(path, path+path_len)), false);
    }

    let posix_flags = 0;

    if (path_flags & 0x01) { // FILESYSTEM_PATH_FLAGS_SYMLINK_FOLLOW

	//TODO
    }

    /*
// Create file if it does not exist, similar to `O_CREAT` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_CREATE (1 << 0)
// Fail if not a directory, similar to `O_DIRECTORY` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_DIRECTORY (1 << 1)
// Fail if file already exists, similar to `O_EXCL` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_EXCLUSIVE (1 << 2)
// Truncate file to size 0, similar to `O_TRUNC` in POSIX.
#define FILESYSTEM_OPEN_FLAGS_TRUNCATE (1 << 3)
    */

    if (open_flags & 1)
	posix_flags |= 00000100;  // O_CREAT
    if (open_flags & 2)
	posix_flags |= 00200000;  // O_DIRECTORY
    if (open_flags & 4)
	posix_flags |= 00000200;  // O_EXCL
    if (open_flags & 8)
	posix_flags |= 00001000;  // O_TRUNC
/*
// Read mode: Data can be read.
#define FILESYSTEM_DESCRIPTOR_FLAGS_READ (1 << 0)
// Write mode: Data can be written to.
#define FILESYSTEM_DESCRIPTOR_FLAGS_WRITE (1 << 1)
*/

    /*if ((flags & 3) == 1)
	posix_flags |= 00000000;  // O_RDONLY
    else if ((flags & 3) == 2)
	posix_flags |= 00000001;  // O_WRONLY
    else if ((flags & 3) == 3)
    posix_flags |= 00000002;  // O_RDWR*/

    if (fdflags & 1) { // APPEND 
	posix_flags |= 00000001;  // O_WRONLY
    }

    console.log("posix_flags="+posix_flags);

    const mode = 0;

    let fd = (Syscalls.openat).bind(Syscalls)(dirfd, path, path_len, posix_flags, mode);

    if (fd < 0) {

	if (trace) {
	    print_trace("<- ret="+(-fd), false);
	}

	return -fd;
    }
    
    setI32(HEAPU8, retptr, fd);

    if (trace) {
	print_trace("<- fd="+fd, false);
    }

    return 0;
}

function p1_path_unlink_file(dirfd, path, path_len) {

    update_heap();

    console.log("--> p1_path_unlink_file: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_unlink_file dirfd="+dirfd+" path="+path+" path_len="+path_len);

	let td = new TextDecoder("utf-8");
	
	print_trace("path="+td.decode(HEAPU8.subarray(path, path+path_len)), false);
    }

    const err = (Syscalls.unlinkat).bind(Syscalls)(dirfd, path, path_len);

    if (trace) {
	print_trace("<- err="+err, false);
    }

    return err;
}

function p1_fd_advise(fd) {

    console.log("--> p1_fd_advise: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_advise fd="+fd);
    }

    // TODO
}

function p1_fd_allocate(fd) {

    console.log("--> p1_fd_allocate: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_allocate fd="+fd);
    }

    // TODO
}


function p1_fd_close(fd) {

    console.log("--> p1_fd_close: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_close fd="+fd);
    }

    if (fd in p1_fd_readdir_entries) {

	delete p1_fd_readdir_entries[fd];
    }

    return ((Syscalls.close).bind(Syscalls))(fd);
}

function p1_fd_datasync(fd) {

    console.log("--> p1_fd_datasync: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_datasync fd="+fd);
    }

    // TODO
}

function p1_fd_readdir(fd, buf, len, cookie, retptr) {

    update_heap();

    console.log("--> p1_fd_readdir: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_readdir fd="+fd+" buf="+buf+" len="+len+" cookie="+cookie+" retptr="+retptr);
    }

    if (!(fd in p1_fd_readdir_entries)) {

	const count = 65536;

	let arr = new Uint8Array(count);
	
	const size = (Syscalls.getdents).bind(Syscalls)(fd, arr, count);

	console.log("<-- getdents: size="+size);

	//console.log(arr);

	// TODO: handle case when need to read more

	if (size < 0) {

	    setI32(HEAPU8, retptr, 0);
	    return 0;
	}

	let arr2_size = 2*size;
	let arr2 = new Uint8Array(arr2_size);

	let offsets = new Array();
	
	let src_off = 0;
	let dst_off = 0;

	let index = 0;

	while (src_off < size) {

	    const d_ino_l = getI32(arr, src_off);
	    const d_ino_u = getI32(arr, src_off+4);
	    const reclen = getI16(arr, src_off+12);
	    const d_type = arr[src_off+12+2];

	    let path_len = reclen-16;

	    //console.log("reclen="+reclen+", path_len="+path_len+", type="+d_type);

	    const entry_size = path_len+24; /*sizeof(__wasi_dirent_t)*/

	    if ( (dst_off+entry_size) > arr2_size ) { // Need to increase size of arr2

		let new_arr2_size = 2 * arr2_size + entry_size;
		let new_arr2 = new Uint8Array(new_arr2_size);

		new_arr2.set(arr2);

		arr2_size = new_arr2_size;
		arr2 = new_arr2;
	    }

	    offsets.push(dst_off);

	    index++;

	    setI32(arr2, dst_off, index); // Cookie is index for wex
	    setI32(arr2, dst_off+4, 0);

	    setI32(arr2, dst_off+8, d_ino_l);
	    setI32(arr2, dst_off+12, d_ino_u);

	    setI32(arr2, dst_off+16, path_len);

	    setI32(arr2, dst_off+20, file_type_from_dt(d_type));

	    arr2.set(arr.subarray(src_off+15, src_off+15+path_len), dst_off+24);

	    let s = "";

	    for (let i = 0; i < path_len; i++) {

		s += String.fromCharCode(arr[src_off+15+i]);
	    }

	    console.log("readdir entry: "+s+" (len="+path_len+" type="+d_type+")");

	    dst_off += entry_size;

	    src_off += reclen;
	}

	p1_fd_readdir_entries[fd] = {

	    buf: arr2,
	    size: dst_off,
	    offsets: offsets
	};

	//console.log("buf size="+dst_off);

	//console.log(p1_fd_readdir_entries[fd].offsets);
    }

    let offset = 0;

    const idx = Number(cookie);

    if (idx > 0) {
	offset = p1_fd_readdir_entries[fd].offsets[idx-1]; // cookie is BigInt and is the index for wex
    }

    if (offset >= p1_fd_readdir_entries[fd].size) {

	setI32(HEAPU8, retptr, 0);
    }
    else {
	
	const l = (len < (p1_fd_readdir_entries[fd].size-offset))?len:p1_fd_readdir_entries[fd].size-offset;
	
	HEAPU8.set(p1_fd_readdir_entries[fd].buf.subarray(offset, offset+l), buf);
	setI32(HEAPU8, retptr, l);
    }

    console.log("buf off="+offset+", read="+getI32(HEAPU8, retptr));

    if (trace) {
	print_trace("<- size="+getI32(HEAPU8, retptr), false);
    }
    
    return 0;
}

function p1_fd_read(fd, iovs, iovs_len, retptr) {

    update_heap();

    console.log("--> p1_fd_read: "+arguments.length);

    if (trace) {
	print_trace("p1::fd_read fd="+fd+" iovs="+iovs+" iovs_len="+iovs_len+" retptr="+retptr);
    }
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    let length = 0;

    for (let i = 0; i < iovs_len; i++) {

	length += getI32(HEAPU8, iovs+4);
    }

    const buf = (Syscalls.blocking_read).bind(Syscalls)(fd, length, 0);

    console.log(buf);

    let _errno = buf[8] | (buf[9] << 8) | (buf[10] << 16) |  (buf[11] << 24);

    if (_errno == 0) {

	let bytes_read = buf[16] | (buf[17] << 8) | (buf[18] << 16) |  (buf[19] << 24);

	let offset = 0;

	if (bytes_read > 0) {

	    let remaining_bytes = bytes_read;

	    for (let i = 0; i < iovs_len; i++) {

		const ptr = getI32(HEAPU8, iovs);
		const buf_len = getI32(HEAPU8, iovs+4);

		let len = 0;

		if (remaining_bytes < buf_len) {
		    
		    len = remaining_bytes;

		    setI32(HEAPU8, iovs+4, len);
		}
		else {

		    len = buf_len;
		}

		if (len > 0) {

		    remaining_bytes -= len;

		    HEAPU8.set(buf.subarray(20+offset, 20+offset+len), ptr);

		    offset += buf_len;
		}
	    }
	}

	setI32(HEAPU8, retptr, bytes_read);

	if (trace) {
	    print_trace("<-- err=ERRNO_SUCCESS bytes_read="+bytes_read, false);
	}

	console.log("<-- p1_fd_read: bytes_read="+bytes_read);

	return 0;
    }
    else {

	if (trace) {
	    print_trace("<-- err="+_errno, false);
	}

	return _errno;

    }
}

function p1_fd_write(fd, iovs, len, retptr) {

    update_heap();

    console.log("--> p1_fd_write: "+fd+", "+iovs+", "+len+", "+retptr);

    if (trace) {
	print_trace("p1::fd_write fd="+fd+" iovs="+iovs+" len="+len+" retptr="+retptr);
    }

    let nb_bytes_written = 0;

    let err = 0;

    for (let i = 0; i < len; i++) {

	let buf = getI32(HEAPU8, iovs);
	let buf_len = getI32(HEAPU8, iovs+4);

	err = ((Syscalls.blocking_write_and_flush).bind(Syscalls))(fd, buf, buf_len, retptr);

	if (err) {

	    if (trace) {
		print_trace("<-- err="+err, false);
	    }
	    
	    return err;
	}

	nb_bytes_written += getI32(HEAPU8, retptr);

	iovs += 8;
    }

    setI32(HEAPU8, retptr, nb_bytes_written);

    if (trace) {
	print_trace("<-- err="+err+" nb_bytes_written="+nb_bytes_written, false);
    }

    return err;
}

function p1_fd_seek(fd, offset, whence, retptr) {

    update_heap();

    console.log("--> p1_fd_seek: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_seek fd="+fd+" offset="+offset+" whence="+whence+" retptr="+retptr);
    }

    let off = (Syscalls.lseek).bind(Syscalls)(fd, Number(offset), whence);

    if (off < 0) {

	return -off;
    }
    
    setI32(HEAPU8, retptr, off);

    return 0;
}

function p1_poll_oneoff(_in, out, nsubscriptions, retptr) {

    update_heap();

    console.log("--> p1_poll_oneoff: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    console.log(HEAPU8.subarray(_in, _in+128));

    if (trace) {
	print_trace("p1::poll_oneoff in="+_in+" out="+out+" nsubscriptions="+nsubscriptions+" retptr="+retptr);
    }

    const sub_size = 40;

    let fd_array = new Array();

    let timeout_idx = -1;
    
    for (let i=0; i < nsubscriptions; i++) {

	console.log(getI64(HEAPU8, sub_size*i+_in)); // userdata

	const tag = HEAPU8[32*i+_in+8];

	console.log("tag="+tag);

	if (tag == 0) { // __WASI_EVENTTYPE_CLOCK

	    timeout_idx = i;
	    
	    const id = getI32(HEAPU8, sub_size*i+_in+16);

	    console.log("id="+id);

	    const timeout = getI64(HEAPU8, sub_size*i+_in+24);

	    console.log("timeout="+timeout);

	    const precision = getI64(HEAPU8, sub_size*i+_in+32);

	    console.log("precision="+precision);

	    let duration = Number(timeout / 1000000n);

	    if (duration == 0)
		duration = 1;

	    fd_array.push({timeout: duration});
	}
	else {

	    //TODO
	}
    }

    const fd = (Syscalls.poll).bind(Syscalls)(fd_array);

    console.log("<-- poll: "+fd);

    if (fd == -1) { // timeout

	console.log("<-- poll: timeout");

	setI32(HEAPU8, retptr, 1);

	setI32(HEAPU8, out, getI32(HEAPU8, sub_size*timeout_idx+_in));
	setI32(HEAPU8, out+4, getI32(HEAPU8, sub_size*timeout_idx+_in+4));

	setI16(HEAPU8, out+8, 0); // error

	HEAPU8[out+9] = 0; // type
	
	return 0;
    }

    return -1;
}

function p1_environ_sizes_get(count, size) {

    update_heap();

    console.log("--> p1_environ_sizes_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::environ_sizes_get count="+count+" size="+size);
    }

    setI32(HEAPU8, count, env_count);
      setI32(HEAPU8, size, env_size);

    /*setI32(HEAPU8, count, 0);
    setI32(HEAPU8, size, 0);*/

    return 0; // __WASI_ERRNO_SUCCESS
}

function p1_environ_get(ptrs, buf) {

    update_heap();

    console.log("--> p1_environ_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::environ_get ptrs="+ptrs+" buf="+buf);
    }

    let ptrs_off = 0;
    let buf_off = 0;

    let last_char = 0;

    for (let i=0; i < env_size; ++i) {

	if (last_char == 0) {
	    
	    setI32(HEAPU8, ptrs+ptrs_off, buf+buf_off);
	    ptrs_off += 4;
	}

	last_char = env[i];

	HEAPU8[buf+buf_off] = last_char;

	buf_off++;
    }

    return 0; // __WASI_ERRNO_SUCCESS
}

function p1_clock_res_get(id) {

    update_heap();

    console.log("--> p1_clock_res_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::clock_res_get id="+id);
    }

    //TODO
}

function p1_clock_time_get(id, precision, retptr) {

    update_heap();

    console.log("--> p1_clock_time_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::clock_time_get id="+id+" precision="+precision+" retptr="+retptr);
    }

    const t = Date.now(); // ms

    setI64(HEAPU8, retptr, BigInt(t)*1000000n); // ns

    if (trace) {
	print_trace("<- ret="+t, false);
    }
}

function p1_args_sizes_get(argc, argv_buf_size) {

    update_heap();
    
    console.log("--> p1_args_sizes_get: argc="+argc+" argv_buf_size="+argv_buf_size);

    if (trace) {
	print_trace("p1::args_sizes_get argc="+argc+" argv_buf_size="+argv_buf_size);
    }

    let _argc = 0;

    for (let i=0; i < args.length; i++) {

	if (args.charCodeAt(i) == 32) {

	    _argc++;
	}
    }

    console.log(_argc+", "+args.length);

    setI32(HEAPU8, argc, _argc);
    setI32(HEAPU8, argv_buf_size, args.length);

    if (trace) {
	print_trace("<- argc="+_argc+" size="+args.length, false);
    }

    return 0;
}

function p1_args_get(argv, argv_buf) {

    update_heap();
    
    console.log("--> p1_args_get: argv="+argv+" argv_buf="+argv_buf);
    console.log(args);

    if (trace) {
	print_trace("p1::args_get argv="+argv+" argv_buf="+argv_buf);
    }

    let index = 0;
    let offset = 0;

    for (let i=0; i < args.length; i++) {

	if (offset >= 0) {
	    setI32(HEAPU8, argv+index*4, argv_buf+offset);
	    offset = -1;
	    index++;
	}

	if (args.charCodeAt(i) != 32) {
	    HEAPU8[argv_buf+i] = args.charCodeAt(i);
	}
	else {
	    HEAPU8[argv_buf+i] = 0;
	    offset = i+1;
	}
    }
    
    return 0;
}

function p1_fd_fdstat_get(fd, retptr) {

    update_heap();

    console.log("--> p1_fd_fdstat_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_fdstat_get fd="+fd+" retptr="+retptr);
    }

    let arr = new Uint8Array(128);

    const len = (Syscalls.fstat).bind(Syscalls)(fd, arr);
    
    console.log("<-- fstat: len="+len);

    if (len >= 0) {

	const mode = getI32(arr, 12);

	console.log("mode="+mode+", desc_type="+desc_type(mode));

	HEAPU8[retptr] = desc_type(mode);

	setI16(HEAPU8, retptr+2, 0); // fs_flags

	setI64(HEAPU8, retptr+8, BigInt(0xffffffff)); // fs_rights_base
	setI64(HEAPU8, retptr+16, BigInt(0xffffffff)); // fs_rights_inheriting

	if (trace) {
	    print_trace("<- ret=ERRNO_SUCCESS fs_filestype="+desc_type(mode), false);
	}

	return 0;
    }

    if (trace) {
	print_trace("<- ret=ERRNO_BADF", false);
    }

    return 8; // __WASI_ERRNO_BADF
}

function p1_fd_fdstat_set_flags(fd) {

    update_heap();

    console.log("--> p1_fd_fdstat_set_flags: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_fdstat_set_flags fd="+fd);
    }

    //TODO
}

function p1_fd_fdstat_set_rights(fd) {

    update_heap();

    console.log("--> p1_fd_fdstat_set_rights: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_fdstat_set_rights fd="+fd);
    }

    //TODO
}

function p1_fd_filestat_get(fd, retptr) {

    update_heap();

    console.log("--> p1_fd_filestat_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_filestat_get fd="+fd);
    }

    let arr = new Uint8Array(128);

    const len = (Syscalls.fstat).bind(Syscalls)(fd, arr);

    if (len >= 0) {

	/*struct stat
{
	dev_t st_dev;
	int __st_dev_padding;
	long __st_ino_truncated;
	mode_t st_mode;
	nlink_t st_nlink;
	uid_t st_uid;
	gid_t st_gid;
	dev_t st_rdev;
	int __st_rdev_padding;
	off_t st_size;
	blksize_t st_blksize;
	blkcnt_t st_blocks;
	struct timespec st_atim;
	struct timespec st_mtim;
	struct timespec st_ctim;
	ino_t st_ino;
};*/

	const dev = getI32(arr, 0);

	setI64(retptr, 0, BigInt(dev));

	const ino = getI32(arr, 0);

	setI64(retptr, 8, BigInt(ino));

	const mode = getI32(arr, 12);

	console.log("mode="+mode+", file_type="+file_type(mode));

	HEAPU8[retptr+16] = file_type(mode);

	const nlink = getI32(arr, 16);

	setI64(retptr, 24, BigInt(nlink));

	const size = getI32(arr, 36);

	setI64(retptr, 32, BigInt(size));

	setI64(retptr, 40, BigInt(0)); // atime
	setI64(retptr, 48, BigInt(0)); // mtime
	setI64(retptr, 56, BigInt(0)); // ctime

	if (trace) {
	    print_trace("<- ret=ERRNO_SUCCESS dev="+dev+" filetype="+file_type(mode)+" nlink="+nlink+" size="+size, false);
	}

	return 0;
    }

    if (trace) {
	print_trace("<- ret=ERRNO_BADF", false);
    }

    return 8; // __WASI_ERRNO_BADF
}

function p1_fd_filestat_set_size(fd) {

    update_heap();

    console.log("--> p1_fd_filestat_set_size: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_filestat_set_size fd="+fd);
    }

    //TODO
}

function p1_fd_filestat_set_times(fd) {

    update_heap();

    console.log("--> p1_fd_filestat_set_times: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_filestat_set_times fd="+fd);
    }

    //TODO
}

function p1_fd_pread(fd) {

    update_heap();

    console.log("--> p1_fd_pread: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_pread fd="+fd);
    }

    //TODO
}

function p1_fd_pwrite(fd) {

    update_heap();

    console.log("--> p1_fd_pwrite: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_pwrite fd="+fd);
    }

    //TODO
}

function p1_fd_renumber(fd) {

    update_heap();

    console.log("--> p1_fd_renumber: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_renumber fd="+fd);
    }

    //TODO
}

function p1_fd_sync(fd) {

    update_heap();

    console.log("--> p1_fd_sync: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_sync fd="+fd);
    }

    //TODO
}

function p1_fd_tell(fd, retptr) {

    update_heap();

    console.log("--> p1_fd_tell: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::fd_tell fd="+fd);
    }

    let arr = new Uint8Array(8);

    const err = (Syscalls.tell).bind(Syscalls)(fd, arr);

    if (!err) {

	console.log("offset = "+getI32(arr,0));

	HEAPU8.set(arr, retptr);

	if (trace) {
	    print_trace("<- ret=ERRNO_SUCCESS offset="+getI32(HEAPU8, retptr), false);
	}

	return 0;
    }
    else {

	setI64(HEAPU8, retptr, BigInt(-1));
    }

    if (trace) {
	print_trace("<- ret="+err, false);
    }

    return err;
}

function p1_path_create_directory(dirfd, path, path_len) {

    update_heap();

    console.log("--> p1_path_create_directory: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_create_directory dirfd="+dirfd+" path="+path+" path_len="+path_len);
    }

    return (Syscalls.mkdirat).bind(Syscalls)(dirfd, path, path_len);
}

function p1_path_filestat_get(fd, flags, path, path_len, retptr) {

    update_heap();

    console.log("--> p1_path_filestat_get: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	
	print_trace("p1::path_filestat_get fd="+fd+" flags="+flags+" path="+path+" path_len="+path_len+" retptr="+retptr);

	let td = new TextDecoder("utf-8");

	let str_path = td.decode(HEAPU8.subarray(path, path+path_len));
	
	print_trace("path="+str_path, false);

	console.log("path="+str_path);
    }

    let arr = new Uint8Array(128);

    const len = (Syscalls.fstatat).bind(Syscalls)(fd, path, path_len, flags, arr);
    
    console.log("<-- fstatat: len="+len);

    console.log(arr);

    if (len >= 0) {

	/*struct stat
{
	dev_t st_dev;
	int __st_dev_padding;
	long __st_ino_truncated;
	mode_t st_mode;
	nlink_t st_nlink;
	uid_t st_uid;
	gid_t st_gid;
	dev_t st_rdev;
	int __st_rdev_padding;
	off_t st_size;
	blksize_t st_blksize;
	blkcnt_t st_blocks;
	struct timespec st_atim;
	struct timespec st_mtim;
	struct timespec st_ctim;
	ino_t st_ino;
};*/

	const dev = getI32(arr, 0);

	setI64(retptr, 0, BigInt(dev));

	const ino = getI32(arr, 0);

	setI64(retptr, 8, BigInt(ino));

	const mode = getI32(arr, 12);

	console.log("mode="+mode+", file_type="+file_type(mode));

	HEAPU8[retptr+16] = file_type(mode);

	const nlink = getI32(arr, 16);

	setI64(retptr, 24, BigInt(nlink));

	const size = getI32(arr, 36);

	setI64(retptr, 32, BigInt(size));

	setI64(retptr, 40, BigInt(0)); // atime
	setI64(retptr, 48, BigInt(0)); // mtime
	setI64(retptr, 56, BigInt(0)); // ctime

	if (trace) {
	    print_trace("<- ret=ERRNO_SUCCESS dev="+dev+" filetype="+file_type(mode)+" nlink="+nlink+" size="+size, false);
	}

	return 0;
    }

    if (trace) {
	print_trace("<- ret=ERRNO_BADF", false);
    }

    return 8; // __WASI_ERRNO_BADF

}

function p1_path_filestat_set_times() {

    update_heap();

    console.log("--> p1_path_filestat_set_times: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_filestat_set_times");
    }

    //TODO

}

function p1_path_link() {

    update_heap();

    console.log("--> p1_path_link: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_link");
    }
    
    //TODO
}

function p1_path_readlink(fd, path, path_len, buf, buf_len, retptr) {

    update_heap();

    console.log("--> p1_path_readlink: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_readlink fd="+fd+" path="+path+" path_len="+path_len+" buf="+buf+" buf_len="+buf_len+" retptr="+retptr);

	let td = new TextDecoder("utf-8");
	
	print_trace("path="+td.decode(HEAPU8.subarray(path, path+path_len)), false);
    }
    
    //const err = (Syscalls.readlinkat).bind(Syscalls)(fd, path, path_len);
    
    return 28; // __WASI_ERRNO_INVAL
}

function p1_path_remove_directory() {

    update_heap();

    console.log("--> p1_path_remove_directory: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_remove_directory");
    }

    //TODOO
}

function p1_path_rename() {

    update_heap();

    console.log("--> p1_path_rename: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_rename");
    }

    //TODO
}

function p1_path_symlink() {

    update_heap();

    console.log("--> p1_path_symlink: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    if (trace) {
	print_trace("p1::path_symlink");
    }

    //TODO
}

const wasi_preview1 = {

    args_get: p1_args_get,
    args_sizes_get: p1_args_sizes_get,
    environ_get: p1_environ_get,
    environ_sizes_get: p1_environ_sizes_get,
    clock_res_get: p1_clock_res_get,
    clock_time_get: p1_clock_time_get,
    fd_advise: p1_fd_advise,
    fd_allocate: p1_fd_allocate,
    fd_close: p1_fd_close,
    fd_datasync: p1_fd_datasync,
    fd_fdstat_get: p1_fd_fdstat_get,
    fd_fdstat_set_flags: p1_fd_fdstat_set_flags,
    fd_fdstat_set_rights: p1_fd_fdstat_set_rights,
    fd_filestat_get: p1_fd_filestat_get,
    fd_filestat_set_size: p1_fd_filestat_set_size,
    fd_filestat_set_times: p1_fd_filestat_set_times,
    fd_pread: p1_fd_pread,
    fd_prestat_get: p1_fd_prestat_get,
    fd_prestat_dir_name: p1_fd_prestat_dir_name,
    fd_pwrite: p1_fd_pwrite,
    fd_read: p1_fd_read,
    fd_readdir: p1_fd_readdir,
    fd_renumber: p1_fd_renumber,
    fd_seek: p1_fd_seek,
    fd_sync: p1_fd_sync,
    fd_tell: p1_fd_tell,
    fd_write: p1_fd_write,
    path_create_directory: p1_path_create_directory,
    path_filestat_get: p1_path_filestat_get,
    path_filestat_set_times: p1_path_filestat_set_times,
    path_link: p1_path_link,
    path_open: p1_path_open,
    path_readlink: p1_path_readlink,
    path_remove_directory: p1_path_remove_directory,
    path_rename: p1_path_rename,
    path_symlink: p1_path_symlink,
    path_unlink_file: p1_path_unlink_file,
    poll_oneoff: p1_poll_oneoff,
    proc_exit: p1_proc_exit,
    proc_raise: p1_proc_raise,
    sched_yield: p1_sched_yield,
    random_get: p1_random_get,
    sock_accept: p1_sock_accept,
    sock_recv: p1_sock_recv,
    sock_send: p1_sock_send,
    sock_shutdown: p1_sock_shutdown
};

const wasi_preview2 = {
    
    "wasi:cli/environment@0.y.z": {

	"get-environment": get_environment,
	"get-arguments": get_arguments,
    },

    "wasi:cli/exit@0.y.z": {

	"exit": (Syscalls.exit).bind(Syscalls),
	"exit-with-code": (Syscalls.exit).bind(Syscalls),
    },

    "wasi:cli/stderr@0.y.z": {

	"get-stderr": get_stderr,
    },
    
    "wasi:cli/stdin@0.y.z": {

	"get-stdin": get_stdin,
    },
    
    "wasi:cli/stdout@0.y.z": {

	"get-stdout": get_stdout,
    },

    "wasi:cli/terminal-stdin@0.y.z": {

	"get-terminal-stdin": get_terminal_stdin,
    },

    "wasi:cli/terminal-stdout@0.y.z": {

	"get-terminal-stdout": get_terminal_stdout,
    },

    "wasi:cli/terminal-stderr@0.y.z": {

	"get-terminal-stderr": get_terminal_stderr,
    },

    "wasi:cli/terminal-input@0.y.z": {

	"[resource-drop]terminal-input": resource_drop_terminal_input,
    },

    "wasi:cli/terminal-output@0.y.z": {

	"[resource-drop]terminal-output": resource_drop_terminal_output,
    },

    "wasi:clocks/monotonic-clock@0.y.z": {
	
	"now": mono_now,
	"subscribe-duration": subscribe_duration,
	"subscribe-instant": subscribe_instant,
    },

    "wasi:clocks/wall-clock@0.y.z": {
	"now": wallclock_now,
    },

    "wasi:config/store@0.y.z": {

	"get": config_get,
	"get-all": config_get_all,
    },

    "wasi:filesystem/preopens@0.y.z": {

	"get-directories": get_directories,
    },

    "wasi:filesystem/types@0.y.z": {

	
	"filesystem-error-code": filesystem_error_code,
	
	"[method]descriptor.append-via-stream": function() { console.log("[method]descriptor.append-via-stream"); return 0; },
	"[method]descriptor.create-directory-at": create_directory_at,
	"[method]descriptor.get-flags": descriptor_get_flags,
	"[method]descriptor.get-type": get_type,
	
	"[method]descriptor.metadata-hash": metadata_hash,
	"[method]descriptor.metadata-hash-at": metadata_hash_at,
	"[method]descriptor.open-at": open_at,
	"[method]descriptor.read-directory": read_directory,
	"[method]descriptor.read-via-stream": read_via_stream,
	"[method]descriptor.remove-directory-at": remove_directory_at,
	"[method]descriptor.stat": stat,
	"[method]descriptor.unlink-file-at": unlink_file_at,
	"[method]descriptor.write-via-stream": write_via_stream,
	"[method]directory-entry-stream.read-directory-entry": read_directory_entry,
	
	"[resource-drop]descriptor": (Syscalls.close).bind(Syscalls),
	"[resource-drop]directory-entry-stream": function() { console.log("[resource-drop]directory-entry-stream"); return 0; },
    },

    "wasi:http/outgoing-handler@0.y.z": {

	"handle": function() { console.log("handle"); return 0; },
    },

    "wasi:http/types@0.y.z": {

	"[constructor]fields": function() { console.log("[constructor]fields"); return 0; },
	"[constructor]outgoing-request": function() { console.log("[constructor]outgoing-request"); return 0; },
	"[method]outgoing-request.set-method": function() { console.log("[method]outgoing-request.set-method"); return 0; },
	"[method]outgoing-request.set-scheme": function() { console.log("[method]outgoing-request.set-scheme"); return 0; },
	"[method]outgoing-request.set-authority": function() { console.log("[method]outgoing-request.set-authority"); return 0; },
	"[method]outgoing-request.set-path-with-query": function() { console.log("[method]outgoing-request.set-path-with-query"); return 0; },
	"[method]outgoing-request.body": function() { console.log("[method]outgoing-request.body"); return 0; },
	"[static]outgoing-body.finish": function() { console.log("[static]outgoing-body.finish"); return 0; },
	"[constructor]request-options": function() { console.log("[constructor]request-options"); return 0; },
	"[method]request-options.set-connect-timeout": function() { console.log("[method]request-options.set-connect-timeout"); return 0; },
	"[method]future-incoming-response.get": function() { console.log("[method]future-incoming-response.get"); return 0; },
	"[resource-drop]future-incoming-response": function() { console.log("[resource-drop]future-incoming-response"); return 0; },
    },
    
    "wasi:io/error@0.y.z": {

	"[resource-drop]error": error,
	"[method]error.to-debug-string": error_to_debug_string,
    },

    "wasi:io/poll@0.y.z": {
	
	"[resource-drop]pollable": function() { console.log("[resource-drop]pollable"); return 0; },
	"poll": poll,
	"[method]pollable.block": pollable_block,	
	"[method]pollable.ready": pollable_ready,
    },

    "wasi:io/streams@0.y.z": {
	
	"[resource-drop]output-stream": function() { console.log("[resource-drop]output-stream"); return 0; },
	"[resource-drop]input-stream": function() { console.log("[resource-drop]input-stream"); return 0; },
	"[method]output-stream.check-write": check_write,
	"[method]output-stream.write": (Syscalls.blocking_write_and_flush).bind(Syscalls),
	"[method]output-stream.blocking-flush": function() { console.log("[method]output-stream.blocking-flush"); return 0; },
	"[method]output-stream.blocking-write-and-flush": (Syscalls.blocking_write_and_flush).bind(Syscalls),
	"[method]output-stream.subscribe": output_stream_subscribe,
	"[method]input-stream.blocking-read": (Syscalls.blocking_read).bind(Syscalls),
	"[method]input-stream.subscribe": input_stream_subscribe,
	"[method]input-stream.read": (Syscalls.blocking_read).bind(Syscalls),
	"[method]output-stream.blocking-splice": output_stream_blocking_splice,
    },

    "wasi:keyvalue/atomics@0.y.z": {

	"increment": atomics_increment,
    },

    "wasi:keyvalue/batch@0.y.z": {

	"get-many": batch_get_many,
	"set-many": batch_set_many,
	"delete-many": batch_delete_many,
    },

    "wasi:keyvalue/store@0.y.z": {

	"[resource-drop]bucket": store_drop_bucket,
	"open": store_open,
	"[method]bucket.get": store_bucket_get,
	"[method]bucket.set": store_bucket_set,
	"[method]bucket.delete": store_bucket_delete,
	"[method]bucket.exists": store_bucket_exists,
	"[method]bucket.list-keys": store_bucket_list_keys,
    },

    "wasi:random/random@0.y.z" : {

	"get-random-bytes": get_random_bytes
    },

    "wasi:sockets/instance-network@0.y.z": {
	
	"instance-network": instance_network,
    },

    "wasi:sockets/network@0.y.z": {
	
	"[resource-drop]network": function() { console.log("[resource-drop]network"); return 0; },
    },

    "wasi:sockets/tcp@0.y.z": {

	"[resource-drop]tcp-socket": (Syscalls.close).bind(Syscalls),
	"[method]tcp-socket.subscribe": tcp_socket_subscribe,
	"[method]tcp-socket.start-connect": start_connect,
	"[method]tcp-socket.finish-connect": finish_connect,
    },
    "wasi:sockets/tcp-create-socket@0.y.z": {

	"create-tcp-socket": create_tcp_socket,
    },

    "wasi:sockets/udp@0.y.z": {

	"[resource-drop]udp-socket": (Syscalls.close).bind(Syscalls),
	"[resource-drop]incoming-datagram-stream": function() { console.log("[resource-drop]incoming-datagram-stream"); return 0; },
	"[resource-drop]outgoing-datagram-stream": function() { console.log("[resource-drop]outgoing-datagram-stream"); return 0; },
	"[method]udp-socket.subscribe": udp_socket_subscribe,
	"[method]udp-socket.start-bind": start_bind,
	"[method]udp-socket.finish-bind": finish_bind,
	"[method]udp-socket.stream": udp_socket_stream,
    },
    
    "wasi:sockets/udp-create-socket@0.y.z": {

	"create-udp-socket": create_udp_socket,
    },
    
};

let importObject = {
    
    "wasi_snapshot_preview1": wasi_preview1,
}

console.log(importObject);

self.onmessage = function(event) {

    console.log(event.data);

    const sharedEventBuffer = event.data.eventBuf;
    const sharedDataBuffer = event.data.dataBuf;
    
    let arr = event.data.file;
    let fileBuffer = arr.buffer;
    
    const sharedEventArray = new Int32Array(sharedEventBuffer);
    const sharedDataArray = new Uint8Array(sharedDataBuffer);

    Syscalls.init(event.data.pid, sharedEventArray, sharedDataArray);

    args = event.data.args;

    env_count = event.data.env_count;
    env_size = event.data.env_size;
    env = event.data.env;

    trace = event.data.trace;
    info = event.data.info;

    directories = event.data.directories;

    if (trace) {

	((Syscalls.is_open).bind(Syscalls))(2);
    }

    Atomics.store(sharedEventArray, 0, 1); // Do not listen main thread events
    
    const bc = new BroadcastChannel("bc");

    const async_log = (arg) => {

	bc.postMessage(arg);

	Atomics.wait(sharedArray, 0, 0);

	Atomics.store(sharedArray, 0, 0);

	//console.log("Worker: continue...");
    }

    /*const importObject = {
	env: { log: async_log },
    };

    WebAssembly.instantiateStreaming(fetch("module.wasm"), importObject).then((obj) => {

	obj.instance.exports.run();
	
	});*/

    

    //console.log(buffer);

    let modules = new Array();

    console.log(arr.subarray(0, 16));

    const magic = getI32(arr, 0);

    const version = getI32(arr, 4);

    console.log("magic:"+magic+", version:"+version);

    if (magic != 0x6D736100) {

	console.log("Not a WASM file");

	if (info) {

	    const buf = new TextEncoder().encode("Not a WASM file\n");

	    ((Syscalls.blocking_write_and_flush).bind(Syscalls))(2, buf, buf.length, 0);
	}

	((Syscalls.exit).bind(Syscalls))(-1);

	return;
    }

    if (version == 0x01) {

	console.log("WASM WASI preview 1");

	if (info) {

	    const buf = new TextEncoder().encode("WASM WASI preview 1\n");

	    ((Syscalls.blocking_write_and_flush).bind(Syscalls))(2, buf, buf.length, 0);
	}

	modules.push(arr);
    }
    else {

	console.log("WASM preview 2 (version="+version+")");

	if (info) {
	    
	    const buf = new TextEncoder().encode("WASM WASI preview 2 (version="+version+")\n");

	    ((Syscalls.blocking_write_and_flush).bind(Syscalls))(2, buf, buf.length, 0);
	}

	let off = 8;

	while (off < fileBuffer.byteLength) {

	    let section_type = arr[off];
	    let section_length;

	    [section_length, off] = u32(arr, off+1);

	    //console.log("Section "+section_type+": "+section_length+" bytes at offset "+off);

	    if (section_type == 1) { // Core module
		
		let buffer2 = fileBuffer.slice(off, off+section_length);

		modules.push(buffer2);
	    }
	    
	    off += section_length;
	}

	//console.log(modules);

	for (let mod of modules) {

	    addImports(mod);
	}
    }

    instantiateModule(modules, version);
}

/*function preRead(fd, iovs, iovs_len, read) {

    console.log("--> preRead: fd:"+fd+", iovs:"+iovs+", iovs_len:"+iovs_len);

    console.log(getI32(HEAPU8, iovs));

    read_ptr = getI32(HEAPU8, iovs);
}

function preReaddir(fd, buf, buf_len, cookie, retptr) {

    console.log("--> preReaddir: "+arguments.length);
    
    for (let i = 0; i < arguments.length; ++i)
	console.log(arguments[i]);

    read_ptr = buf;
}*/

function addImport(mod_name, name) {

    console.log(mod_name+","+name);

    if (info) {

	const buf = new TextEncoder().encode("Import "+mod_name+":"+name+"\n");

	((Syscalls.blocking_write_and_flush).bind(Syscalls))(2, buf, buf.length, 0);
    }

    if (mod_name.indexOf("wasi:") == 0) { // WASI p2 or >

	if (!(mod_name in importObject)) {

	    const re = /wasi:(.*)@(\d)\.(\d)\.(\d).*/;
	    const found = mod_name.match(re);

	    const gen_mod_name = "wasi:" + found[1] + "@" + found[2] + ".y.z";

	    importObject[mod_name] = wasi_preview2[gen_mod_name];
	}
    }
    else {

	if (!(mod_name in importObject)) {

	    importObject[mod_name] = {};
	}

	if (!(name in importObject[mod_name])) {

	    importObject[mod_name][name] = (function (_mod_name, _name) {

		return function(...args) { console.log(">> Redirected func: "+_mod_name+", "+_name); let res = (getFunc(_name))(...args); if (_name == "cabi_realloc") update_heap(); console.log("<<"); return res;};

	    })(mod_name, name);
	}
    }
}

function addImports(module) {

    let module_length = 0;
    let off = 8;

    while (off < module.byteLength) {

	let arr2 = new Uint8Array(module);

	let section_type = arr2[off];
	let section_length;

	module_length = off;

	//console.log("Core module section "+section_type+", offset="+off);

	[section_length, off] = u32(arr2, off+1);

	//console.log("section_length="+section_length+" bytes, offset="+off);

	if (section_type == 2) { // import section

	    let [count, off2] =  u32(arr2, off);

	    //console.log(count+" imports");

	    for (let i=0; i < count; i++) {

		let nb_bytes;

		[nb_bytes, off2] =  u32(arr2, off2);

		let mod_name = "";

		for (let j=0; j < nb_bytes; j++) {

		    mod_name += String.fromCharCode(arr2[off2+j]);
		}

		//console.log(mod_name);

		[nb_bytes, off2] =  u32(arr2, off2+nb_bytes);

		let name = "";

		for (let j=0; j < nb_bytes; j++) {

		    name += String.fromCharCode(arr2[off2+j]);
		}

		//console.log(name);

		addImport(mod_name, name);

		off2 += nb_bytes;

		let desc = arr2[off2];

		off2++;

		switch (desc) {

		case 0: // func

		    {
			let idx;

			[idx, off2] =  u32(arr2, off2);
		    }
		    break;
		    
		case 1: // table

		    {

			let ref_type = arr2[off2];
			off2++;

			if (arr2[off2] == 0) {

			    let min;

			    [min, off2] =  u32(arr2, off2+1);
			}
			else {

			    let min, max;

			    [min, off2] =  u32(arr2, off2+1);
			    [max, off2] =  u32(arr2, off2);
			}
		    }

		    break;
		    
		case 2: // mem

		    {
			if (arr2[off2] == 0) {

			    let min;

			    [min, off2] =  u32(arr2, off2+1);
			}
			else {

			    let min, max;

			    [min, off2] =  u32(arr2, off2+1);
			    [max, off2] =  u32(arr2, off2);
			}
		    }

		    break;

		case 3: // global

		    {

			let globaltype = arr2[off2];
			off2++;
			let mut = arr2[off2];
			off2++;
		    }

		    break;
		}
	    }

	    //console.log(importObject);
	}
	else if (section_type == 0) { // Custom section is the last one, skip it

	    // Stop here

	    break;
	}
	
	off += section_length;
    }

    module.module_length = module_length;
}

function getFunc(name) {

    for (inst of instances) {

	if (name in inst.exports) {
	    return inst.exports[name];
	}
    }
};

function insertExport(name, obj) {

    if (typeof obj === 'function')
	return;

    console.log("insertExport: "+name+", "+typeof obj);

    for (const [key, value] of Object.entries(importObject)) {

	if (name in value) {

	    value[name] = obj;
	    break;
	}
    }
}

function moduleInstantiated(instance) {

    instances.push(instance);

    if ("memory" in instance.exports) {

	memory = instance.exports.memory;

	update_heap();
    }

    console.log("!!! Exports");

    for (const [key, value] of Object.entries(instance.exports)) {

	console.log(key);

	insertExport(key, value);
    }
}

function instantiateModule(modules, version) {

    console.log("!!! instantiateModule !!!");

    if (modules.length > 0) {

	WebAssembly.instantiate(modules[0].slice(0, modules[0].module_length), importObject).then((obj) => {

		//console.log(obj);
		//console.log(JSON.stringify(obj.instance.exports));

		moduleInstantiated(obj.instance);

	    instantiateModule(modules.slice(1), version);
	    
	    }).catch((e) => {

		console.log(e);

		const buf = new TextEncoder().encode(e.message+"\n");

		((Syscalls.blocking_write_and_flush).bind(Syscalls))(2, buf, buf.length, 0);

		((Syscalls.exit).bind(Syscalls))(-1);
		
	    });
    }
    else {

	try {

	    do_preopens();

	    console.log("--> run");

	    let start_func = "";

	    if (version == 0x01) {

		start_func = "_start";
	    }
	    else {

		start_func = "wasi:cli/run@0.2.0#run";
	    }

	    (getFunc(start_func))();
	}
	catch (error) {

	    console.log(error);
	}
	
	console.log("End of program execution");

	((Syscalls.exit).bind(Syscalls))(0);
    }
}

function u32(array, offset) {

    let val = 0;
    let i = 0;
    let end = false;

    while (!end) {

	end = !(array[offset] & 0x80);

	val += (array[offset] & 0x7f) << i;

	offset++;
	i += 7;
    }

    return [val, offset];
}
