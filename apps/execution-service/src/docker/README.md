# Code Runner Images

This directory contains minimal images used by the execution worker.

## Build

Build Python runner image:

```bash
docker build -f apps/execution-service/src/docker/Dockerfile.python -t code-runner-python .
```

Build JavaScript runner image:

```bash
docker build -f apps/execution-service/src/docker/Dockerfile.javascript -t code-runner-javascript .
```

## Quick Test

Python:

```bash
mkdir -p /tmp/code-python
printf 'print("hello from python")\n' > /tmp/code-python/code.py
docker run --rm --memory=256m --cpus=0.5 --network=none -v /tmp/code-python:/app:ro code-runner-python
```

JavaScript:

```bash
mkdir -p /tmp/code-js
printf 'console.log("hello from javascript")\n' > /tmp/code-js/code.js
docker run --rm --memory=256m --cpus=0.5 --network=none -v /tmp/code-js:/app:ro code-runner-javascript
```

On Windows PowerShell, replace `/tmp/...` with a local folder path.
