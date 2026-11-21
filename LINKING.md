Dynamic linking is an essential function for every program made of several components.

# Library generation

Here is a simple side module containing a `add` function:

```
__attribute__((visibility("default")))
int add(int a, int b)
{
    return a + b;
}
```

```
$CC -fPIC -O2 -c side_module.c -o side_module.o

$LD -O2 --shared side_module.o -o side_module.wasm
```

# Main module generation

```
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>

__attribute__((export_name("get_dependencies")))
const char * get_dependencies() {
  return "side_module.wasm\n";
}

const char * lib = "side_module.wasm";

struct linker_op {

  int op;
  int arg;
  int length;
  char data[128];
};

int main() {

  printf("Hello world!\n");

  int fd = open("/dev/linker", O_RDWR);

  printf("fd=%d errno=%d\n", fd, errno);

  struct linker_op lop;

  lop.op = 1;
  lop.arg = 0;
  lop.length = strlen(lib);
  
  strcpy((char *)&(lop.data), lib);
  
  write(fd, &lop, sizeof(lop));

  int res;
  
  read(fd, &res, sizeof(res));
  
  printf("Result of last linker op %d = %d\n", lop.op, res);

  if ((lop.op == 1) && (res > 0)) {
    
    lop.op = 2;
    lop.arg = res;

    const char * fun = "add";

    lop.length = strlen(fun);
  
    strcpy((char *)&(lop.data), fun);
    
    write(fd, &lop, sizeof(lop));

    read(fd, &res, sizeof(res));
    
    printf("Result of last linker op %d = %d\n", lop.op, res);

    int (*add)(int,int) = (void *)res;
    
    int c = add(1, 2);

    printf("Result of add(%d,%d) = %d\n", 1, 2, c);
  }
  
  
  return 0;
}
```

```
$CC -fPIE -c main.c -o main.o

$LD --pie main.o side_module.wasm -o main.wasm
```


# Wex linking

