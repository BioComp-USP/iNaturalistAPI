FROM ubuntu:16.04

RUN apt-get update && apt-get install -y curl git nano python gcc-5-base libc6-dev libgcc-5-dev libstdc++6 libstdc++-5-dev

RUN curl -sL https://deb.nodesource.com/setup_5.x -o nodesource_setup.sh && bash nodesource_setup.sh && apt-get install -y nodejs

RUN useradd -m inat && usermod -aG sudo inat

ENV APP_HOME /home/inat/api/

RUN mkdir $APP_HOME

WORKDIR $APP_HOME
