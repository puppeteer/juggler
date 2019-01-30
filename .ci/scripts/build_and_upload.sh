set -e

if [ -e ./mach ]; then
  echo Checking Juggler root - OK
else
  echo Please run this script from the Juggler root
  exit 1;
fi

if [ -z "$(git status --untracked-files=no --porcelain)" ]; then
  echo "Working directory clean - OK"
else
  echo "Working directory is not clean - FAIL"
  exit 1
fi

SHA=$(git rev-parse HEAD)

set +e
gsutil ls gs://juggler-builds/$SHA/ >/dev/null 2>/dev/null
retVal=$?
set -e

if [ $retVal -eq 0 ]; then
  echo "gs://juggler-builds/$SHA already exists - FAIL"
  echo "NOTE: If you want to re-upload, run 'gsutil rm $SHA' first."
  exit 1
else
  echo "gs://juggler-builds/$SHA is vacant - OK"
fi

OBJ_FOLDER=""
ARCH_NAME=""
if [ "$(uname)" == "Darwin" ]; then
  # Setup for Mac OS X platform
  OBJ_FOLDER="obj-x86_64-apple-darwin17.7.0"
  ARCH_NAME="firefox-mac.zip"
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
  # Setup for Linux
  OBJ_FOLDER="obj-x86_64-pc-linux-gnu"
  ARCH_NAME="firefox-linux.zip"
else
  echo "UNKNOWN ENVIRONMENT; CANNOT PROCEED!"
  exit 1
fi

# rm -rf $OBJ_FOLDER
# ./mach bootstrap --application-choice=browser --no-interactive
./mach build
./mach package
cd $OBJ_FOLDER/dist/
zip -r $ARCH_NAME firefox
gsutil mv firefox-linux.zip gs://juggler-builds/$SHA/
cd -
echo "UPLOADED TO: gs://juggler-builds/$SHA"
