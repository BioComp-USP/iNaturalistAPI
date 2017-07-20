FROM ubuntu:16.04

RUN apt-get update && apt-get install -y curl git python gcc-5-base libc6-dev libgcc-5-dev libstdc++6 libstdc++-5-dev

RUN curl -sL https://deb.nodesource.com/setup_8.x -o nodesource_setup.sh && bash nodesource_setup.sh

RUN apt-get install -y nodejs

ENV APP_HOME /usr/src/iNaturalistAPI/
RUN mkdir $APP_HOME
WORKDIR $APP_HOME
ADD . $APP_HOME

RUN npm install

RUN npm install promise mapnik request
