#!/bin/bash

#information
SERVICE_NAME='zelcash'
COIN_NAME='flux'
COIN_DAEMON='fluxd'
COIN_CLI='flux-cli'
COIN_PATH='/usr/local/bin'
#end of required details

apt_number=$(ps aux | grep 'apt' | wc -l)
if [[ "$apt_number" > 1 ]]; then
   sudo killall apt > /dev/null 2>&1
   sudo killall apt-get > /dev/null 2>&1
   sudo dpkg --configure -a > /dev/null 2>&1
fi
    

# add to path
PATH=$PATH:"$COIN_PATH"
export PATH

#Closing zelcash daemon and purge apt package
sudo systemctl stop "$SERVICE_NAME" && sleep 3

if [[ -f /usr/local/bin/$COIN_CLI ]]; then
  "$COIN_CLI" stop >/dev/null 2>&1 && sleep 3 
else
  zelcash-cli stop >/dev/null 2>&1 && sleep 3
fi

sudo killall "$COIN_DAEMON" >/dev/null 2>&1

sudo killall -s SIGKILL zelbenchd >/dev/null 2>&1 && sleep 1
sudo killall -s SIGKILL fluxbenchd >/dev/null 2>&1 && sleep 1
sudo apt-get purge --auto-remove "$COIN_NAME" zelcash -y >/dev/null 2>&1 && sleep 1
sudo rm /etc/apt/sources.list.d/zelcash.list > /dev/null 2>&1
sudo rm /etc/apt/sources.list.d/flux.list > /dev/null 2>&1

   
if [[ "$(lsb_release -cs)" == "xenial" ]]; then
   
     echo 'deb https://apt.runonflux.io/ '"$(lsb_release -cs)"' main' | sudo tee --append /etc/apt/sources.list.d/flux.list > /dev/null 2>&1  
     gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv 4B69CA27A986265D > /dev/null 2>&1
     gpg --export 4B69CA27A986265D | sudo apt-key add - > /dev/null 2>&1    
     
     if ! gpg --list-keys Zel > /dev/null; then    
         gpg --keyserver hkp://keys.gnupg.net:80 --recv-keys 4B69CA27A986265D > /dev/null 2>&1
         gpg --export 4B69CA27A986265D | sudo apt-key add - > /dev/null 2>&1   
     fi

    sudo apt-get update -y
    sudo apt-get install "$COIN_NAME" -y
    sudo chmod 755 "$COIN_PATH/"* && sleep 2
          
else
   


  if gpg -k --keyring /usr/share/keyrings/flux-archive-keyring.gpg Zel > /dev/null 2>&1; then
   
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/flux-archive-keyring.gpg] https://apt.runonflux.io/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/flux.list > /dev/null 2>&1
    sudo apt-get update -y
    sudo apt-get install "$COIN_NAME" -y
    sudo chmod 755 "$COIN_PATH/"* && sleep 2

  else

     sudo chown -R "$USER:$USER" /usr/share/keyrings > /dev/null 2>&1
     # cleaning in case if corrupted
     sudo rm /usr/share/keyrings/flux-archive-keyring.gpg > /dev/null 2>&1  
     echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/flux-archive-keyring.gpg] https://apt.runonflux.io/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/flux.list > /dev/null 2>&1  
 
     #downloading key && save it as keyring  
     gpg --no-default-keyring --keyring /usr/share/keyrings/flux-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 4B69CA27A986265D > /dev/null 2>&1

     if ! gpg -k --keyring /usr/share/keyrings/flux-archive-keyring.gpg Zel > /dev/null 2>&1; then
        sudo rm /usr/share/keyrings/flux-archive-keyring.gpg > /dev/null 2>&1
        gpg --no-default-keyring --keyring /usr/share/keyrings/flux-archive-keyring.gpg --keyserver hkp://na.pool.sks-keyservers.net:80 --recv-keys 4B69CA27A986265D > /dev/null 2>&1
     fi


     if ! gpg -k --keyring /usr/share/keyrings/flux-archive-keyring.gpg Zel > /dev/null 2>&1; then
        sudo rm /usr/share/keyrings/flux-archive-keyring.gpg > /dev/null 2>&1
        gpg --no-default-keyring --keyring /usr/share/keyrings/flux-archive-keyring.gpg --keyserver hkp://keys.gnupg.net:80 --recv-keys 4B69CA27A986265D > /dev/null 2>&1
     fi

    sudo apt-get update -y
    sudo apt-get install "$COIN_NAME" -y
    sudo chmod 755 "$COIN_PATH/"* && sleep 2

fi

fi
    
if sudo systemctl list-units --full --no-legend --no-pager --plain --all --type service "$SERVICE_NAME.service" | grep -Foq "$SERVICE_NAME.service"; then
  sudo systemctl start "$SERVICE_NAME"
else
  "$COIN_DAEMON"
fi
