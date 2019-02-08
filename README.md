# Juggler

> Juggler - Firefox Automation Protocol for implementing the Puppeteer API.

This repository is a fork of the Firefox browser with additional support for the "Juggler" remote debugging protocol.
Juggler can be found in [`//testing/juggler/`](https://github.com/Puppeteer/juggler/blob/master/testing/juggler).

## Protocol

See [`//testing/juggler/Protocol.js`](https://github.com/Puppeteer/juggler/blob/master/testing/juggler/Protocol.js).

## Building FF with Juggler

1. Clone the Juggler repository (without history to make things faster)
```bash
git clone --depth 1 https://github.com/Puppeteer/juggler
cd juggler
```

2. Bootstrap a host environment for the Firefox build and compile Firefox locally

```bash
# OPTIONAL - bootstrap host environment.
./mach bootstrap --application-choice=browser --no-interactive
# Compile browser
./mach build
```

### Troubleshooting when building FF on Mac
#### Black screen after FF Build
As of Jan. 2019 there is a known
[bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1493330) that will cause an
entirely black screen when running the nightly build of firefox built with the
**MacOSX SDK version 10.14.**

The easiest fix right now is downgrading your MacOSX SDK.

To do so:

1) Go to [this repo](https://github.com/phracker/MacOSX-SDKs) and install any **SDK version < 10.14** (e.g. 10.13 works fine)

2) In the `juggler/firefox` folder:

```bash
echo "ac_add_options --with-macos-sdk=path/to/sdk" >> .mozconfig
# your SDK might be located at
# /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/
```

3) run `./mach build` again


#### Missing headers in /usr/include

On MacOS 10.14 (Mojave) you might run into issues when building FF.

The error is related to [a change in the xcode-select installation](https://bugzilla.mozilla.org/show_bug.cgi?id=1487552)

To workaround this issue you can simply run:

```bash
# Write missing headers to /usr/include
sudo installer -pkg /Library/Developer/CommandLineTools/Packages/macOS_SDK_headers_for_macOS_10.14.pkg -target /
```

## Running Firefox with Juggler

Juggle adds a `-juggler` CLI flag that accepts a port to expose a remote protocol on.
Pass `0` to pick a random port - Juggler will print its port to STDOUT.

```bash
./mach run -- -juggler 0
```

## Uploading builds to Google Storage

> **QUICK:** on Linux and OSX, just use `//.ci/scripts/build_and_upload.sh`

Firefox builds with Juggler support are uploaded to the gs://juggler-builds/ bucket.

Project maintainers can upload builds.
To upload a build, do the following:

1. Install [gcloud](https://cloud.google.com/sdk/install) if you haven't yet.
2. Authenticate in the cloud and select the project

```bash
gcloud auth login
gcloud config set project juggler-builds
```

3. Make sure **firefox is compiled**. After that, package a build for redistribution:

```bash
./mach package
```

4. Archive the build and copy it to the gbucket

We want to ship `*.zip` archives so that it will be easy to decompress them on the node-side.

- Linux: `.ci/scripts/upload_linux.sh`
- Mac: `.ci/scripts/upload_mac.sh`

