/*
    Copyright 2020 SOLTECSIS SOLUCIONES TECNOLOGICAS, SLU
    https://soltecsis.com
    info@soltecsis.com


    This file is part of FWCloud (https://fwcloud.net).

    FWCloud is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    FWCloud is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with FWCloud.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientRequest } from 'http';
import * as https from 'https';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as express from 'express';
import * as fs from 'fs';

export type WebsrvServiceConfig = {
  host: string;
  port: number;
  docroot: string;
  api_url: string;
  remove_api_string_from_url: boolean;
  https: boolean;
  cert: string;
  key: string;
  ca_bundle: string;
}

@Injectable()
export class WebsrvService {
  private _cfg: WebsrvServiceConfig;
  private _express: any;
  private _server: https.Server | http.Server;
  private _proxy: httpProxy;
  
  constructor (private configService: ConfigService) {
    this._cfg = <WebsrvServiceConfig>this.configService.get('websrv');
    this._express = express();
    
    try {
      this._proxy = httpProxy.createProxyServer({
        target: this._cfg.api_url,
        secure: false,
        ws: true
      });
    } catch(err) {
      console.error(`Error creating proxy server: ${err.message}`);
      process.exit(err);
    }
  }

  private proxySetup(): void {
    try {
      // Proxy API calls.
      this._express.all('/api/*', (req, res) => {
        const orgURL = req.url;
        
        if (this._cfg.remove_api_string_from_url) req.url = req.url.substr(4);
        
        console.log(`Proxing request: ${orgURL} -> ${this._cfg.api_url}${req.url}`);
        this._proxy.web(req, res);
      });

      // Proxy socket.io calls.
      // proxy HTTP GET / POST
      this._express.get('/socket.io/*', (req, res) => {
        console.log("Proxying GET request", req.url);
        this._proxy.web(req, res, { target: this._cfg.api_url});
      });
      this._express.post('/socket.io/*', (req, res) => {
        console.log("Proxying POST request", req.url);
        this._proxy.web(req, res, { target: this._cfg.api_url});
      });

      // Proxy websockets
      // ATENTION: Very important, the event must be over the server object, NOT over the express handler function.
      this._server.on('upgrade', (req, socket, head) => {
        console.log(`Proxying upgrade request: ${req.url}`);
        this._proxy.ws(req, socket, head);
      });

      // Set origin header if not exists.
      this._proxy.on('proxyReq', (proxyReq: ClientRequest, req, res, options) => {
        if (!proxyReq.getHeader('origin')) {
          if (proxyReq.getHeader('referer')) {
            const referer: string = proxyReq.getHeader('referer').toString();
            if (referer) {
              const origin = referer.substr(0,referer.indexOf('/',referer.indexOf('://')+3));
              proxyReq.setHeader('origin', origin);
            } 
          } else proxyReq.setHeader('origin', '');
        }
      });

      this._proxy.on('error', (err, req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`ERROR: Proxing request: ${req.url}`);
        console.error(`ERROR: Proxing request: ${req.url} - `, err)
      });

      // Document root for the web server static files.
      this._express.use(express.static(this._cfg.docroot));
    } catch (err) {
      console.error(`Application can not start: ${err.message}`);
      console.error(err.stack);
      process.exit(1);
    }
  }

  public async start(): Promise<any> {
    try {
      this._server = this._cfg.https ? this.startHttpsServer() : this.startHttpServer();
      this.proxySetup();
      this.bootstrapEvents();
    } catch (err) {
        console.error(`ERROR CREATING HTTP/HTTPS SERVER: ${err.message}`);
        process.exit(1);
    }

    return this;
}

  private startHttpsServer(): https.Server {
    const tlsOptions = {
        key: fs.readFileSync(this._cfg.key).toString(),
        cert: fs.readFileSync(this._cfg.cert).toString(),
        ca: this._cfg.ca_bundle ? fs.readFileSync(this._cfg.ca_bundle).toString() : null
    }

    return https.createServer(tlsOptions, this._express);
  }

  private startHttpServer(): http.Server {
    return http.createServer(this._express);
  }

  private bootstrapEvents() {
    this._server.listen(this._cfg.port, this._cfg.host);

    this._server.on('error', (error: Error) => {
        throw error;
    });

    this._server.on('listening', () => {
      //logger().info(`${this._type==='api_server' ? 'API server' : 'WEB server'} listening on ` + this.getFullURL());
      console.log(`FWCloud WEB server listening on ${this.getFullURL()}`)
    });
  }

  protected getFullURL(): string {
    return (this._cfg.https ? 'https' : 'http') + '://' + this._cfg.host 
    + ':' 
    + this._cfg.port;
  }
}